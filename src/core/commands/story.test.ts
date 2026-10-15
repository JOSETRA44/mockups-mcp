import { describe, expect, it } from 'vitest'
import { evaluate, evaluateChannels } from '../animation/evaluate'
import { createProject } from '../factory'
import { musicGrid } from '../music/sync'
import { parseProject, type MusicAnalysis, type Project } from '../schema/project'
import { shotHoldTimes } from '../shots/shots'
import { runCommand } from './index'
import { addAssetToProject } from './assets'

const fresh = (): Project => ({ ...createProject('story'), clips: [], tracks: [] })

/** A perfectly steady 120 BPM analysis: beats every 0.5 s, bars every 2 s, energy jump at 16 s. */
function steadyAnalysis(seconds = 60): MusicAnalysis {
  const beats = Array.from({ length: seconds * 2 }, (_, i) => i * 0.5)
  return {
    analyzer: 'test', duration: seconds, bpm: 120, beats, bars: beats.filter((_, i) => i % 4 === 0),
    sections: [{ start: 0, end: 16, energy: 0.2, label: 'intro' }, { start: 16, end: seconds, energy: 1, label: 'peak' }],
  }
}

function withMusic(p: Project): Project {
  return addAssetToProject(p, { id: 'song', kind: 'audio', name: 'song.mp3', mime: 'audio/mpeg', width: 0, height: 0, duration: 60 }, { analysis: steadyAnalysis() })
}

describe('shots', () => {
  const story = () => runCommand(fresh(), 'set_shots', {
    shots: [
      { kind: 'angle', duration: 2 },
      { kind: 'focus', duration: 2, region: { x: 0.5, y: 0.2, size: 0.3, w: 0.95 } },
      { kind: 'focus', duration: 2, region: { x: 0.5, y: 0.85, size: 0.25, w: 0.95 }, transition: 0 },
      { kind: 'hero', duration: 2 },
    ],
  }).project

  it('lays shots out back to back and sets the scene length', () => {
    const p = story()
    expect(p.shots.map((s) => s.start)).toEqual([0, 2, 4, 6])
    expect(p.settings.duration).toBe(8)
  })

  it('frames the requested screen region', () => {
    const p = story()
    const [, top, bottom, hero] = shotHoldTimes(p.shots).map((t) => evaluateChannels(p, t))
    expect(top['camera.target.y']).toBeGreaterThan(0.4)
    expect(bottom['camera.target.y']).toBeLessThan(-0.4)
    expect(top['camera.distance']).toBeLessThan(hero['camera.distance'])
  })

  it('arrives exactly at the shot start and moves continuously (except cuts)', () => {
    const p = story()
    const fps = 60
    let prev = evaluateChannels(p, 0)
    for (let i = 1; i <= 8 * fps; i++) {
      const t = i / fps
      const cur = evaluateChannels(p, t)
      const jump = Math.abs(cur['camera.target.y'] - prev['camera.target.y'])
      const isCut = Math.abs(t - 4) < 1 / fps + 1e-9 // shot 3 has transition 0
      if (!isCut) expect(jump).toBeLessThan(0.12)
      prev = cur
    }
  })

  it('roll-edits durations so later shots stay in place', () => {
    const p = story()
    const out = runCommand(p, 'update_shot', { shotId: p.shots[1].id, duration: 3 }).project
    expect(out.shots.map((s) => s.start)).toEqual([0, 2, 5, 6])
    const ripple = runCommand(p, 'update_shot', { shotId: p.shots[1].id, duration: 3, ripple: true }).project
    expect(ripple.shots.map((s) => s.start)).toEqual([0, 2, 5, 7])
  })

  it('bakes shots into camera keyframes that reproduce them', () => {
    const p = story()
    const baked = runCommand(p, 'bake_shots', {}).project
    expect(baked.shots).toHaveLength(0)
    for (const t of [1, 3.1, 5.5]) {
      expect(evaluateChannels(baked, t)['camera.distance']).toBeCloseTo(evaluateChannels(p, t)['camera.distance'], 2)
    }
  })

  it('storyboard aims at the UI blocks detected in the screenshot', () => {
    let p = addAssetToProject(fresh(), {
      id: 'shot', kind: 'image', name: 'a.png', mime: 'image/png', width: 390, height: 844,
      regions: [{ x: 0.5, y: 0.22, size: 0.25, w: 0.95 }, { x: 0.5, y: 0.9, size: 0.14, w: 0.9 }],
    })
    p = runCommand(p, 'create_storyboard', {}).project
    const focus = p.shots.filter((s) => s.kind === 'focus')
    expect(focus.map((s) => s.region.y)).toEqual([0.22, 0.9])
  })

  it('storyboard uses musical lengths when there is a song', () => {
    const { project, result } = runCommand(withMusic(fresh()), 'create_storyboard', { focusCount: 2, barsPerShot: 2 })
    expect(result?.secondsPerShot).toBe(4)
    expect(project.shots.map((s) => s.kind)).toEqual(['angle', 'focus', 'focus', 'hero'])
  })
})

describe('music', () => {
  it('importing audio sets the music track, not a screen', () => {
    const p = withMusic(fresh())
    expect(p.music?.assetId).toBe('song')
    expect(p.nodes.find((n) => n.type === 'device' && n.screen.assetId === 'song')).toBeUndefined()
  })

  it('fit_to_music puts shot boundaries on bars and the length on a phrase', () => {
    let p = withMusic(fresh())
    p = runCommand(p, 'set_shots', { shots: [{ kind: 'angle', duration: 1.7 }, { kind: 'focus', duration: 3.1 }, { kind: 'hero', duration: 2.4 }] }).project
    p = runCommand(p, 'add_motion', { preset: 'hero-reveal', start: 0, duration: 1.3 }).project
    const { project, result } = runCommand(p, 'fit_to_music', {})
    for (const s of project.shots) expect((s.start / 2) % 1).toBeCloseTo(0) // bars every 2 s
    expect((project.settings.duration / 8) % 1).toBeCloseTo(0) // 4-bar phrases = 8 s
    expect(result?.duration).toBe(project.settings.duration)
    const entrance = project.clips[0]
    expect(((entrance.start + entrance.duration) / 2) % 1).toBeCloseTo(0)
  })

  it('offset shifts the grid into project time', () => {
    const p = runCommand(withMusic(fresh()), 'set_music', { offset: 16 }).project
    expect(musicGrid(p)!.bars[0]).toBe(0)
    expect(musicGrid(p)!.sections[0].label).toBe('peak')
  })

  it('accents push the camera on downbeats of energetic sections only', () => {
    let p = withMusic(fresh())
    p = runCommand(p, 'set_music', { accents: 'strong' }).project
    const d = (t: number) => evaluateChannels(p, t)['camera.distance']
    expect(d(18.07)).toBeLessThan(d(17.9) - 0.05) // peak section: punch just after the downbeat at 18 s
    expect(d(4.07)).toBeCloseTo(d(3.9), 6) // intro: no accents
  })

  it('set_tempo rebuilds and shifts the grid', () => {
    let p = withMusic(fresh())
    p = runCommand(p, 'set_tempo', { bpm: 100, firstBeat: 0.3 }).project
    expect(p.music!.analysis!.beats[1] - p.music!.analysis!.beats[0]).toBeCloseTo(0.6, 3)
    const before = p.music!.analysis!.bars[0]
    p = runCommand(p, 'set_tempo', { shiftDownbeat: 1 }).project
    expect(p.music!.analysis!.bars[0]).toBeCloseTo(before + 0.6, 3)
  })

  it('fit_to_music explains what is missing', () => {
    expect(() => runCommand(fresh(), 'fit_to_music', {})).toThrow(/no music/)
  })
})

describe('looks and migration', () => {
  it('applies looks, including one matched to the media palette', () => {
    let p = runCommand(fresh(), 'apply_look', { look: 'noir' }).project
    expect(p.settings.lighting.preset).toBe('dramatic')
    expect(() => runCommand(p, 'apply_look', { look: 'match-media' })).toThrow(/palette/)
    p = addAssetToProject(p, { id: 'img', kind: 'image', name: 'a.png', mime: 'image/png', width: 10, height: 10, palette: ['#f4f6fb', '#2f6bff'] })
    p = runCommand(p, 'apply_look', { look: 'match-media' }).project
    expect(p.settings.background.kind).toBe('gradient')
  })

  it('migrates version 1 documents', () => {
    const v1 = { ...createProject(), version: 1 } as Record<string, unknown>
    delete v1.shots
    delete v1.music
    const p = parseProject(v1)
    expect(p.version).toBe(2)
    expect(p.shots).toEqual([])
    expect(p.music).toBeNull()
  })
})

describe('shot media (several screens in one story)', () => {
  const withMaterial = () => {
    let p = fresh()
    p = addAssetToProject(p, { id: 'home', kind: 'image', name: 'home.png', mime: 'image/png', width: 1080, height: 2400, regions: [{ x: 0.5, y: 0.3, size: 0.25, w: 0.95 }] }, { assign: true })
    p = addAssetToProject(p, { id: 'take', kind: 'video', name: 'take.mp4', mime: 'video/mp4', width: 1080, height: 2400, duration: 6, trim: { in: 1, out: 4.5 }, poster: 4 }, { assign: false })
    return p
  }

  it('swaps the screen at the cut and plays the take from its trimmed start', () => {
    let p = withMaterial()
    p = runCommand(p, 'set_shots', {
      shots: [{ kind: 'hero', duration: 2 }, { kind: 'focus', duration: 5, media: { assetId: 'take' } }],
    }).project
    const dev = (t: number) => evaluate(p, t).devices[0].screen
    expect(dev(1.9).assetId).toBe('home')
    expect(dev(2.0).assetId).toBe('take')
    expect(dev(2.0).mediaTime).toBeCloseTo(1)
    expect(dev(3.5).mediaTime).toBeCloseTo(2.5)
    // Past the trimmed end the take holds its last frame.
    expect(dev(6.5).mediaTime).toBeLessThan(4.5)
    expect(dev(6.5).mediaTime).toBeGreaterThan(4.4)
  })

  it('speed and from are honoured; unknown or audio media is rejected', () => {
    let p = withMaterial()
    p = runCommand(p, 'set_shots', { shots: [{ kind: 'focus', duration: 2, media: { assetId: 'take', from: 2, speed: 0.5 } }] }).project
    expect(evaluate(p, 1).devices[0].screen.mediaTime).toBeCloseTo(2.5)
    expect(() => runCommand(p, 'set_shots', { shots: [{ kind: 'hero', duration: 1, media: { assetId: 'nope' } }] })).toThrow(/No asset/)
  })

  it('the device default screen loops over the trimmed part', () => {
    let p = withMaterial()
    p = runCommand(p, 'set_screen', { assetId: 'take' }).project
    expect(evaluate(p, 0).devices[0].screen.mediaTime).toBeCloseTo(1)
    expect(evaluate(p, 3.6).devices[0].screen.mediaTime).toBeCloseTo(1.1)
  })

  it('storyboard from material: one shot per asset, in order, framed for readability', () => {
    const p = runCommand(withMaterial(), 'create_storyboard', { assetIds: ['home', 'take'] }).project
    expect(p.shots.map((s) => s.kind)).toEqual(['angle', 'focus', 'focus', 'hero'])
    expect(p.shots.map((s) => s.media?.assetId)).toEqual(['home', 'home', 'take', 'take'])
    expect(p.shots[1].region.y).toBe(0.3) // the still focuses its detected block
    expect(p.shots[2].move).toBe('hold') // a take is shown steadily
    expect(p.shots[2].media?.from).toBe(1)
  })
})
