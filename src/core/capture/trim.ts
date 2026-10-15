/**
 * Turns a take's motion curve (mean frame difference per sample) into an edit decision:
 * where the useful part starts and ends, and the moments worth showing (the UI settled after
 * each action). Pure, so the same logic serves the renderer, the server and tests.
 */
export interface MotionAnalysis {
  /** Seconds into the video. */
  in: number
  out: number
  /** Settled moments after activity (good posters / shot holds), seconds. */
  moments: number[]
  /** The single best still: the last settled moment (the result of the action). */
  poster: number
  /** Active spans [start, end] in seconds. */
  active: [number, number][]
}

export function analyzeMotion(curve: number[], fps: number, opts: { lead?: number; tail?: number } = {}): MotionAnalysis {
  const lead = opts.lead ?? 0.35
  const tail = opts.tail ?? 0.8
  const duration = curve.length / fps
  if (!curve.length) return { in: 0, out: 0, moments: [], poster: 0, active: [] }
  const sorted = [...curve].sort((a, b) => a - b)
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0
  const thr = Math.max(0.004, p95 * 0.12)

  // Active spans, bridging gaps shorter than 0.25 s (one gesture rarely stops that briefly).
  const active: [number, number][] = []
  const gap = Math.round(0.25 * fps)
  let i = 0
  while (i < curve.length) {
    if (curve[i] <= thr) { i++; continue }
    let j = i
    let quiet = 0
    while (j + 1 < curve.length && quiet <= gap) {
      j++
      quiet = curve[j] > thr ? 0 : quiet + 1
    }
    const end = j - quiet
    active.push([i / fps, (end + 1) / fps])
    i = end + 1
  }

  if (!active.length) {
    const mid = +(duration / 2).toFixed(3)
    return { in: 0, out: +duration.toFixed(3), moments: [mid], poster: mid, active: [] }
  }

  const moments: number[] = []
  active.forEach(([, end], k) => {
    const next = active[k + 1]?.[0] ?? duration
    // A moment needs the UI to stay still long enough to read (≥ 0.35 s).
    if (next - end >= 0.35) moments.push(+Math.min(next - 0.05, end + 0.25).toFixed(3))
  })
  const start = Math.max(0, active[0][0] - lead)
  const end = Math.min(duration, active[active.length - 1][1] + tail)
  return {
    in: +start.toFixed(3),
    out: +end.toFixed(3),
    moments,
    poster: moments[moments.length - 1] ?? +((start + end) / 2).toFixed(3),
    active: active.map(([a, b]) => [+a.toFixed(3), +b.toFixed(3)] as [number, number]),
  }
}

/** Mean absolute difference between two RGBA buffers (0..1), sampling every 4th pixel. */
export function frameDifference(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let sum = 0, n = 0
  for (let i = 0; i < a.length; i += 16) {
    sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
    n += 3
  }
  return n ? sum / n / 255 : 0
}

/** True when a frame is (almost) uniformly black: protected windows (FLAG_SECURE) or screen off. */
export function isBlankFrame(rgba: ArrayLike<number>, ignoreTopRows = 0, width = 0): boolean {
  let bright = 0, n = 0
  const start = ignoreTopRows * width * 4
  for (let i = start; i < rgba.length; i += 32) {
    if (rgba[i] + rgba[i + 1] + rgba[i + 2] > 30) bright++
    n++
  }
  return n > 0 && bright / n < 0.01
}
