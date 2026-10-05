import { getPreset } from '../presets/registry'
import { layoutShots, shotsEnd } from '../shots/shots'
import type { Project, Shot } from '../schema/project'

/**
 * Music ↔ timeline. The song is placed on the project timeline with `offset` (song time at
 * project t = 0). Everything here works in *project* time.
 */

export interface Grid {
  bpm: number
  beat: number
  /** Beat and bar times in project seconds (only those ≥ 0). */
  beats: number[]
  bars: number[]
  sections: { start: number; end: number; energy: number; label: string }[]
}

export function musicGrid(project: Project): Grid | null {
  const m = project.music
  const a = m?.analysis
  if (!m || !a || !a.beats.length) return null
  const shift = (t: number) => +(t - m.offset).toFixed(4)
  return {
    bpm: a.bpm,
    beat: 60 / a.bpm,
    beats: a.beats.map(shift).filter((t) => t >= -1e-3),
    bars: a.bars.map(shift).filter((t) => t >= -1e-3),
    sections: a.sections.map((s) => ({ ...s, start: shift(s.start), end: shift(s.end) })).filter((s) => s.end > 0),
  }
}

function nearest(list: number[], t: number) {
  let best = list[0], d = Infinity
  for (const x of list) {
    const dx = Math.abs(x - t)
    if (dx < d) { d = dx; best = x }
  }
  return best
}

/**
 * Snaps a time to the musical grid: to a bar when one is within `barWindow` seconds, else to
 * the nearest beat. Bars win because decisions (shot changes) belong on bars.
 */
export function snapToGrid(grid: Grid | null, t: number, opts: { barWindow?: number; beatsOnly?: boolean } = {}) {
  if (!grid || !grid.beats.length) return t
  if (!opts.beatsOnly && grid.bars.length) {
    const bar = nearest(grid.bars, t)
    if (Math.abs(bar - t) <= (opts.barWindow ?? grid.beat * 0.75)) return bar
  }
  return nearest(grid.beats, t)
}

/** Bar time by index, extrapolating past the end of the song with the median bar length. */
function barAt(bars: number[], i: number, barLen: number) {
  if (i < bars.length) return bars[i]
  return bars[bars.length - 1] + (i - bars.length + 1) * barLen
}

function median(a: number[]) {
  const s = [...a].sort((x, y) => x - y)
  return s[Math.floor(s.length / 2)] ?? 0
}

export interface FitReport {
  barsPerShot: number[]
  duration: number
  snappedToSections: number
}

/**
 * Fit to music: shot boundaries move onto bars (preferring section changes), the total length
 * becomes a whole number of phrases, entrance motions land on the first downbeat after they
 * start, other motions start on a beat. Order and relative lengths of shots are preserved.
 */
export function fitToMusic(project: Project, opts: { phrase?: number; sectionSnap?: boolean } = {}): { project: Project; report: FitReport } {
  const grid = musicGrid(project)
  if (!grid || grid.bars.length < 2) throw new Error('The song has no detected bars yet. Add music (it is analysed on import) or set the tempo.')
  const phrase = opts.phrase ?? 4
  const barLen = median(grid.bars.slice(1).map((b, i) => b - grid.bars[i]))
  // Bars measured from project time 0: the first bar at or after 0 is index 0.
  const bars = grid.bars
  const first = bars[0]

  let shots: Shot[] = project.shots
  let snapped = 0
  let barsPerShot: number[] = []
  let duration: number

  if (shots.length) {
    const n = shots.map((s, i) => Math.max(1, Math.round((i === 0 ? s.duration - first : s.duration) / barLen)))
    // Round the total to whole phrases (up, unless that adds more than half a phrase).
    const total = n.reduce((a, b) => a + b, 0)
    let target = Math.round(total / phrase) * phrase
    if (target < n.length) target = Math.ceil(n.length / phrase) * phrase
    let diff = target - total
    const byLength = () => n.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]).map(([, i]) => i)
    while (diff > 0) for (const i of byLength()) { if (diff <= 0) break; n[i]++; diff-- }
    while (diff < 0) {
      const i = byLength().find((k) => n[k] > 1)
      if (i === undefined) break
      n[i]--
      diff++
    }

    // Cumulative bar indices of the boundaries between shots.
    const cuts: number[] = []
    n.reduce((acc, v, i) => {
      if (i < n.length - 1) cuts.push(acc + v)
      return acc + v
    }, 0)

    if (opts.sectionSnap !== false) {
      const sectionBars = grid.sections.slice(1).map((s) => bars.findIndex((b) => Math.abs(b - s.start) < barLen / 2)).filter((i) => i > 0)
      cuts.forEach((c, k) => {
        const prev = k === 0 ? 0 : cuts[k - 1]
        const nextCut = k + 1 < cuts.length ? cuts[k + 1] : n.reduce((a, b) => a + b, 0)
        const target = sectionBars.find((sb) => Math.abs(sb - c) === 1 && sb > prev && sb < nextCut)
        if (target !== undefined) { cuts[k] = target; snapped++ }
      })
    }

    const totalBars = n.reduce((a, b) => a + b, 0)
    const edges = [0, ...cuts.map((c) => barAt(bars, c, barLen)), barAt(bars, totalBars, barLen)]
    barsPerShot = [cuts[0] ?? totalBars, ...cuts.slice(1).map((c, k) => c - cuts[k]), totalBars - (cuts[cuts.length - 1] ?? 0)].slice(0, shots.length)
    shots = layoutShots(shots.map((s, i) => {
      const d = +(edges[i + 1] - edges[i]).toFixed(4)
      // A transition never eats more than half of the shot it leaves.
      const prevLen = i > 0 ? edges[i] - edges[i - 1] : Infinity
      return { ...s, duration: d, transition: Math.min(s.transition, prevLen / 2) }
    }))
    duration = shotsEnd(shots)
  } else {
    const k = Math.max(phrase, Math.round((project.settings.duration - first) / barLen / phrase) * phrase)
    duration = +barAt(bars, k, barLen).toFixed(4)
  }

  const clips = project.clips.map((c) => {
    const preset = getPreset(c.presetId)
    if (preset?.category === 'entrance') {
      // The entrance lands on the first downbeat at least 1 s after it starts.
      const land = bars.find((b) => b >= c.start + 1) ?? c.start + c.duration
      return { ...c, duration: +(land - c.start).toFixed(4) }
    }
    if (preset?.category === 'loop') {
      const start = snapToGrid(grid, c.start)
      return { ...c, start, duration: +Math.max(0.5, duration - start).toFixed(4) }
    }
    return { ...c, start: snapToGrid(grid, c.start, { beatsOnly: true }) }
  })

  return {
    project: {
      ...project,
      shots,
      clips,
      settings: { ...project.settings, duration: +duration.toFixed(3) },
      music: project.music ? { ...project.music, fadeOut: Math.min(Math.max(project.music.fadeOut, barLen / 2), barLen) } : null,
      updatedAt: Date.now(),
    },
    report: { barsPerShot, duration: +duration.toFixed(3), snappedToSections: snapped },
  }
}

const ACCENT_AMOUNT = { off: 0, subtle: 0.035, strong: 0.08 } as const

/**
 * Musical accents: a short camera push on downbeats of energetic sections, scaled by the
 * section's energy. Skipped near shot changes so we never stack two events on one beat.
 * Returns a multiplier offset for camera distance (e.g. -0.03 = 3% closer).
 */
export function accentAt(project: Project, t: number, grid = musicGrid(project)): number {
  const mode = project.music?.accents ?? 'off'
  if (mode === 'off' || !grid) return 0
  const amount = ACCENT_AMOUNT[mode]
  let total = 0
  for (const bar of grid.bars) {
    const dt = t - bar
    if (dt < 0) break
    if (dt > 1.2) continue
    const section = grid.sections.find((s) => bar >= s.start && bar < s.end)
    const energy = section?.energy ?? 0
    if (energy < 0.55) continue
    if (project.shots.some((s) => Math.abs(s.start - bar) < 0.2)) continue
    // Fast attack (60 ms), smooth release (~350 ms).
    const env = dt < 0.06 ? dt / 0.06 : Math.exp(-(dt - 0.06) / 0.35)
    total -= amount * energy * env
  }
  return total
}
