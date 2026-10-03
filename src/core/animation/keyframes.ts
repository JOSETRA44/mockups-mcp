import type { EaseId, Keyframe } from '../schema/project'
import { ease } from './easing'

/** Samples sorted keyframes at time t; holds the first/last value outside the range. */
export function sampleKeyframes(keys: readonly Keyframe[], t: number): number {
  if (keys.length === 0) return 0
  if (t <= keys[0].t) return keys[0].value
  const last = keys[keys.length - 1]
  if (t >= last.t) return last.value
  // Binary search for the segment containing t.
  let lo = 0, hi = keys.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (keys[mid].t <= t) lo = mid
    else hi = mid
  }
  const a = keys[lo], b = keys[hi]
  const u = (t - a.t) / (b.t - a.t)
  return a.value + (b.value - a.value) * ease(a.ease, u)
}

/** A normalised key used by presets: u ∈ [0,1] across the clip. */
export interface NormKey {
  u: number
  v: number
  /** Ease from this key to the next. */
  ease?: EaseId | string
}

/** Builds a sampler u → value from normalised keys. */
export function keys(list: NormKey[], defaultEase: EaseId | string = 'easeInOut') {
  const kf: Keyframe[] = list.map((k) => ({ t: k.u, value: k.v, ease: (k.ease ?? defaultEase) as EaseId }))
  return (u: number) => sampleKeyframes(kf, u)
}
