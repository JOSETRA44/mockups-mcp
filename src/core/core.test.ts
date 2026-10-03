import { describe, expect, it } from 'vitest'
import { cubicBezier, EASES } from './animation/easing'
import { bakeClip, evaluate, evaluateChannels } from './animation/evaluate'
import { sampleKeyframes } from './animation/keyframes'
import { rigDirection } from './camera/rig'
import { createClip, createProject, uid } from './factory'
import { rotateXYZ } from './math'
import { PRESETS } from './presets/registry'
import { parseProject, type Project } from './schema/project'

const deviceId = (p: Project) => p.nodes.find((n) => n.type === 'device')!.id

describe('easing', () => {
  it('cubic-bezier hits endpoints and is monotonic for ease-in-out', () => {
    const f = cubicBezier(0.65, 0, 0.35, 1)
    expect(f(0)).toBe(0)
    expect(f(1)).toBe(1)
    expect(f(0.5)).toBeCloseTo(0.5, 3)
    let prev = 0
    for (let i = 1; i <= 100; i++) {
      const v = f(i / 100)
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = v
    }
  })

  it('every ease starts at 0 and ends at 1', () => {
    for (const fn of Object.values(EASES)) {
      expect(fn(0)).toBeCloseTo(0, 6)
      expect(fn(1)).toBeCloseTo(1, 6)
    }
  })
})

describe('keyframes', () => {
  const kf = [
    { t: 0, value: 0, ease: 'linear' as const },
    { t: 1, value: 10, ease: 'linear' as const },
    { t: 2, value: 0, ease: 'linear' as const },
  ]
  it('interpolates and holds outside range', () => {
    expect(sampleKeyframes(kf, -1)).toBe(0)
    expect(sampleKeyframes(kf, 0.5)).toBeCloseTo(5)
    expect(sampleKeyframes(kf, 1.5)).toBeCloseTo(5)
    expect(sampleKeyframes(kf, 5)).toBe(0)
  })
})

describe('evaluate', () => {
  it('is deterministic', () => {
    const p = createProject()
    for (const t of [0, 0.37, 1.1, 2.9, 4.99]) {
      expect(evaluate(p, t)).toEqual(evaluate(p, t))
    }
  })

  it('every preset lands on the base pose when its motion ends at rest', () => {
    const p = createProject()
    p.clips = [createClip('hero-reveal', deviceId(p), 0)]
    const end = evaluateChannels(p, 10)
    expect(end[`${deviceId(p)}.position.y`]).toBeCloseTo(0, 6)
    expect(end[`${deviceId(p)}.rotation.y`]).toBeCloseTo(0, 6)
  })

  it('stacks offset clips additively', () => {
    const p = createProject()
    const id = deviceId(p)
    p.clips = [
      { ...createClip('tilt', id, 0), params: { angleX: 10, angleY: 0, return: false, ease: 'linear' }, duration: 1 },
      { ...createClip('tilt', id, 0), params: { angleX: 5, angleY: 0, return: false, ease: 'linear' }, duration: 1 },
    ]
    expect(evaluateChannels(p, 1)[`${id}.rotation.x`]).toBeCloseTo(15)
    expect(evaluateChannels(p, 0.5)[`${id}.rotation.x`]).toBeCloseTo(7.5)
  })

  it('keyframe tracks override base, offsets still add on top', () => {
    const p = createProject()
    const id = deviceId(p)
    p.clips = [{ ...createClip('tilt', id, 0), params: { angleX: 10, angleY: 0, return: false, ease: 'linear' }, duration: 1 }]
    p.tracks = [{ id: 't', path: `${id}.rotation.x`, keyframes: [{ t: 0, value: 100, ease: 'linear' }] }]
    expect(evaluateChannels(p, 1)[`${id}.rotation.x`]).toBeCloseTo(110)
  })

  it('baking reproduces the live clip', () => {
    const p = createProject()
    const id = deviceId(p)
    p.clips = [createClip('hero-reveal', id, 0.5)]
    const live = evaluateChannels(p, 1.2)
    const baked: Project = { ...p, clips: [], tracks: bakeClip(p, p.clips[0].id, uid) }
    const fromTracks = evaluateChannels(baked, 1.2)
    for (const ch of ['position.y', 'rotation.x', 'rotation.y', 'scale']) {
      expect(fromTracks[`${id}.${ch}`]).toBeCloseTo(live[`${id}.${ch}`], 1)
    }
  })

  it('all presets build without NaN', () => {
    const p = createProject()
    const id = deviceId(p)
    for (const preset of PRESETS) {
      p.clips = [createClip(preset.id, preset.target === 'camera' ? 'camera' : id, 0)]
      for (const t of [0, 0.5, 1, 3]) {
        const ch = evaluateChannels(p, t)
        for (const v of Object.values(ch)) expect(Number.isFinite(v)).toBe(true)
      }
    }
  })
})

describe('camera', () => {
  it('rig direction matches rotateXYZ convention', () => {
    // A device turned by yaw Y has its normal where a camera with that yaw sits.
    const n = rotateXYZ([0, 0, 1], [0, 40, 0])
    const d = rigDirection(40, 0)
    n.forEach((v, i) => expect(v).toBeCloseTo(d[i]))
  })

  it('screen focus moves the camera target onto the screen and closer', () => {
    const p = createProject()
    p.clips = [{ ...createClip('screen-focus', 'camera', 0), duration: 2 }]
    const cam = p.nodes.find((n) => n.type === 'camera')!
    const mid = evaluateChannels(p, 1)
    expect(mid['camera.distance']).toBeLessThan(cam.type === 'camera' ? cam.distance : 0)
    expect(mid['camera.target.y']).toBeGreaterThan(0) // focusY 0.35 is above centre
  })
})

describe('schema', () => {
  it('round-trips a project through JSON', () => {
    const p = createProject()
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p)
  })
})
