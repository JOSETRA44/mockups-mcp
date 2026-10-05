import type { ScreenRegion } from '../schema/project'

/**
 * Finds the UI blocks worth focusing on in an app screenshot (cards, hero numbers, buttons)
 * so "Create camera story" aims at real content instead of guessing. Pure: takes RGBA
 * pixels of a small thumbnail, works the same in the editor, the headless renderer and tests.
 *
 * Mobile UIs are vertical stacks, so we segment rows: a row is "active" when it differs from
 * the background or has strong horizontal edges; runs of active rows become blocks.
 */
export function detectRegions(data: Uint8ClampedArray | Uint8Array, width: number, height: number, max = 4): ScreenRegion[] {
  if (width < 8 || height < 8) return []
  const px = (x: number, y: number) => {
    const i = (y * width + x) * 4
    return [data[i], data[i + 1], data[i + 2]]
  }
  // Background = most common coarse colour along the left/right margins.
  const counts = new Map<string, { n: number; c: number[] }>()
  for (let y = 0; y < height; y++) {
    for (const x of [1, width - 2]) {
      const c = px(x, y)
      const key = c.map((v) => v >> 4).join(',')
      const e = counts.get(key) ?? { n: 0, c }
      e.n++
      counts.set(key, e)
    }
  }
  const bg = [...counts.values()].sort((a, b) => b.n - a.n)[0].c
  const diff = (c: number[], d: number[]) => Math.abs(c[0] - d[0]) + Math.abs(c[1] - d[1]) + Math.abs(c[2] - d[2])

  const rowActivity = new Float64Array(height)
  const colHits: Uint8Array[] = []
  for (let y = 0; y < height; y++) {
    const hits = new Uint8Array(width)
    let a = 0
    for (let x = 1; x < width - 1; x++) {
      const c = px(x, y)
      const off = diff(c, bg) > 60
      const edge = diff(c, px(x - 1, y)) > 70
      if (off || edge) { hits[x] = 1; a++ }
    }
    rowActivity[y] = a / width
    colHits.push(hits)
  }

  // Ignore the status bar and home indicator areas.
  const top = Math.round(height * 0.06), bottom = Math.round(height * 0.97)
  const active = (y: number) => y >= top && y <= bottom && rowActivity[y] > 0.08
  const bands: [number, number][] = []
  const gap = Math.max(1, Math.round(height * 0.012))
  for (let y = top; y <= bottom; y++) {
    if (!active(y)) continue
    const last = bands[bands.length - 1]
    if (last && y - last[1] <= gap) last[1] = y
    else bands.push([y, y])
  }

  const regions = bands
    .filter(([a, b]) => b - a + 1 >= height * 0.03)
    .map(([a, b]) => {
      let x0 = width, x1 = 0, sum = 0
      for (let y = a; y <= b; y++) {
        sum += rowActivity[y]
        for (let x = 0; x < width; x++) if (colHits[y][x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x) }
      }
      const h = (b - a + 1) / height
      const w = Math.max(1, x1 - x0 + 1) / width
      return {
        score: h * w * (sum / (b - a + 1)),
        region: {
          x: +((x0 + x1 + 1) / 2 / width).toFixed(3),
          y: +((a + b + 1) / 2 / height).toFixed(3),
          // A little breathing room around the block, never smaller than a button needs.
          size: +Math.min(0.9, Math.max(0.14, h * 1.35)).toFixed(3),
          w: +Math.min(1, Math.max(0.3, w * 1.08)).toFixed(3),
        },
      }
    })

  return regions
    .sort((p, q) => q.score - p.score)
    .slice(0, max)
    .map((r) => r.region)
    .sort((p, q) => p.y - q.y)
}
