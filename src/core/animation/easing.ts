import type { EaseId } from '../schema/project'
import { PRODUCT_BEZIER, SPRING } from './feel'

export type EaseFn = (u: number) => number

/** CSS-compatible cubic-bezier, solved with Newton-Raphson + bisection fallback. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EaseFn {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx

  const solveT = (x: number) => {
    let t = x
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x
      if (Math.abs(err) < 1e-6) return t
      const d = slopeX(t)
      if (Math.abs(d) < 1e-6) break
      t -= err / d
    }
    let lo = 0, hi = 1
    t = x
    for (let i = 0; i < 30; i++) {
      const v = sampleX(t)
      if (Math.abs(v - x) < 1e-6) break
      if (v < x) lo = t
      else hi = t
      t = (lo + hi) / 2
    }
    return t
  }

  return (u) => (u <= 0 ? 0 : u >= 1 ? 1 : sampleY(solveT(u)))
}

export function spring(damping = SPRING.damping, settle = SPRING.settle): EaseFn {
  const zeta = Math.min(0.999, Math.max(0.05, damping))
  const omega = settle / zeta
  const omegaD = omega * Math.sqrt(1 - zeta * zeta)
  return (u) => {
    if (u <= 0) return 0
    if (u >= 1) return 1
    const decay = Math.exp(-zeta * omega * u)
    return 1 - decay * (Math.cos(omegaD * u) + ((zeta * omega) / omegaD) * Math.sin(omegaD * u))
  }
}

export const EASES: Record<EaseId, EaseFn> = {
  linear: (u) => u,
  easeIn: cubicBezier(0.42, 0, 1, 1),
  easeOut: cubicBezier(0, 0, 0.58, 1),
  easeInOut: cubicBezier(0.65, 0, 0.35, 1),
  product: cubicBezier(...PRODUCT_BEZIER),
  expoOut: cubicBezier(0.19, 1, 0.22, 1),
  backOut: cubicBezier(0.34, 1.56, 0.64, 1),
  spring: spring(),
}

export const EASE_IDS = Object.keys(EASES) as EaseId[]

export const ease = (id: EaseId | string | undefined, u: number) =>
  (EASES[id as EaseId] ?? EASES.easeInOut)(u)
