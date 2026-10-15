import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny'
import { analyzeMotion, frameDifference } from '@/core/capture/trim'
import type { ScreenRegion } from '@/core/schema/project'
import { detectRegions } from '@/core/vision/regions'

/**
 * Video material intelligence: where the useful part of a take is, which moments are worth
 * holding on, and what UI the best frame contains. Runs in the editor and in headless Chrome.
 */
export interface TakeAnalysis {
  trim: { in: number; out: number }
  moments: number[]
  poster: number
  palette: string[]
  regions: ScreenRegion[]
}

const SAMPLE_FPS = 10

export async function analyzeVideo(blob: Blob): Promise<TakeAnalysis | null> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) return null
    const duration = await input.computeDuration()
    const first = await track.getFirstTimestamp()
    const aspect = track.displayWidth / track.displayHeight
    const w = 72, h = Math.max(8, Math.round(w / aspect))
    const sink = new CanvasSink(track, { width: w, height: h, fit: 'fill', poolSize: 2 })
    const times = Array.from({ length: Math.max(2, Math.floor((duration - first) * SAMPLE_FPS)) }, (_, i) => first + i / SAMPLE_FPS)
    const g = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })!
    const curve: number[] = []
    let prev: Uint8ClampedArray | null = null
    for await (const frame of sink.canvasesAtTimestamps(times)) {
      if (!frame) continue
      g.drawImage(frame.canvas as CanvasImageSource, 0, 0)
      const data = g.getImageData(0, 0, w, h).data
      curve.push(prev ? frameDifference(prev, data) : 0)
      prev = new Uint8ClampedArray(data)
    }
    const motion = analyzeMotion(curve, SAMPLE_FPS)
    const shift = (t: number) => +(t + first).toFixed(3)

    // UI blocks and colours come from the poster: the settled result of the action.
    const pw = 90, ph = Math.max(8, Math.round(pw / aspect))
    const posterFrame = await new CanvasSink(track, { width: pw, height: ph, fit: 'fill' }).getCanvas(shift(motion.poster))
    const pg = new OffscreenCanvas(pw, ph).getContext('2d', { willReadFrequently: true })!
    if (posterFrame) pg.drawImage(posterFrame.canvas as CanvasImageSource, 0, 0)
    const pixels = pg.getImageData(0, 0, pw, ph).data
    const { paletteOfPixels } = await import('./audio')
    return {
      trim: { in: shift(motion.in), out: Math.min(duration, shift(motion.out)) },
      moments: motion.moments.map(shift),
      poster: shift(motion.poster),
      palette: paletteOfPixels(pixels),
      regions: detectRegions(pixels, pw, ph),
    }
  } finally {
    input.dispose()
  }
}

/** Draws one frame of a stored video/image asset into a canvas region (used by review sheets). */
export async function drawAssetFrame(g: OffscreenCanvasRenderingContext2D, blob: Blob, kind: 'image' | 'video', time: number, x: number, y: number, w: number, h: number) {
  if (kind === 'image') {
    const bmp = await createImageBitmap(blob)
    g.drawImage(bmp, x, y, w, h)
    bmp.close()
    return
  }
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) return
    const frame = await new CanvasSink(track, { width: Math.round(w), height: Math.round(h), fit: 'fill' }).getCanvas(time)
    if (frame) g.drawImage(frame.canvas as CanvasImageSource, x, y, w, h)
  } finally {
    input.dispose()
  }
}
