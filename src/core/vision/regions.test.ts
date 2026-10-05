import { describe, expect, it } from 'vitest'
import { detectRegions } from './regions'

/** Paints rectangles on a light background, like a simple app screen. */
function screen(w: number, h: number, rects: { x: number; y: number; w: number; h: number; c: [number, number, number] }[]) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) data.set([244, 246, 251, 255], i * 4)
  for (const r of rects) {
    for (let y = Math.round(r.y * h); y < Math.round((r.y + r.h) * h); y++) {
      for (let x = Math.round(r.x * w); x < Math.round((r.x + r.w) * w); x++) data.set([...r.c, 255], (y * w + x) * 4)
    }
  }
  return data
}

describe('detectRegions', () => {
  it('finds a hero card and a bottom button, top to bottom', () => {
    const data = screen(90, 195, [
      { x: 0.05, y: 0.15, w: 0.9, h: 0.2, c: [79, 70, 229] }, // balance card
      { x: 0.05, y: 0.88, w: 0.9, h: 0.06, c: [11, 31, 58] }, // button
    ])
    const r = detectRegions(data, 90, 195)
    expect(r).toHaveLength(2)
    expect(r[0].y).toBeCloseTo(0.25, 1)
    expect(r[0].w).toBeGreaterThan(0.9)
    expect(r[1].y).toBeCloseTo(0.91, 1)
    expect(r[1].size).toBeGreaterThanOrEqual(0.14)
  })

  it('ignores the status bar and returns nothing for a blank screen', () => {
    expect(detectRegions(screen(90, 195, [{ x: 0, y: 0, w: 1, h: 0.04, c: [0, 0, 0] }]), 90, 195)).toEqual([])
  })

  it('keeps at most `max` blocks, choosing the most prominent', () => {
    const rects = [0.1, 0.3, 0.5, 0.7].map((y, i) => ({ x: 0.05, y, w: i === 2 ? 0.9 : 0.4, h: 0.1, c: [30, 30, 30] as [number, number, number] }))
    const r = detectRegions(screen(90, 195, rects), 90, 195, 2)
    expect(r).toHaveLength(2)
    expect(r.some((x) => Math.abs(x.y - 0.55) < 0.03)).toBe(true) // the wide block wins
  })
})
