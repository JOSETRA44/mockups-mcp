import {
  AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, StreamTarget, WebMOutputFormat,
  canEncodeAudio, canEncodeVideo, type AudioCodec, type Target, type VideoCodec,
} from 'mediabunny'
import { Zip, ZipPassThrough } from 'fflate'
import { evaluate } from '@/core/animation/evaluate'
import type { Project } from '@/core/schema/project'
import { Engine } from '@/engine/Engine'
import { AssetSourceProvider } from '@/engine/sources/sources'
import { mixdown } from '@/media/audio'

export type ExportFormat = 'mp4' | 'webm' | 'png'
export type ExportQuality = 'standard' | 'high' | 'max'

export interface ExportOptions {
  format: ExportFormat
  /** Multiplier on the project resolution (0.5 = draft, 2 = 2× / 4K from 1080p). */
  scale: number
  fps: number
  quality: ExportQuality
  /** Sub-frames per frame for motion blur (1 = off). */
  motionBlur: number
  includeAudio: boolean
  /** When given, the file is streamed to disk instead of being held in memory. */
  fileHandle?: FileSystemFileHandle
}

export interface ExportResult {
  blob: Blob | null
  filename: string
  codec: string
  frames: number
  seconds: number
}

export interface ExportCallbacks {
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
}

/** Bits per pixel per frame → bitrate. Ads get re-encoded by every platform, so err high. */
const BPP: Record<ExportQuality, number> = { standard: 0.12, high: 0.24, max: 0.42 }

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

export function outputSize(project: Project, scale: number) {
  return { width: even(project.settings.width * scale), height: even(project.settings.height * scale) }
}

export function exportSupport() {
  return {
    webcodecs: typeof VideoEncoder !== 'undefined',
    offscreen: typeof OffscreenCanvas !== 'undefined',
    saveToDisk: typeof (window as any).showSaveFilePicker === 'function',
  }
}

async function pickCodec(format: ExportFormat, width: number, height: number, bitrate: number): Promise<VideoCodec> {
  const candidates: VideoCodec[] = format === 'mp4' ? ['avc', 'hevc', 'vp9', 'av1'] : ['vp9', 'vp8', 'av1']
  for (const c of candidates) {
    if (await canEncodeVideo(c, { width, height, bitrate })) return c
  }
  throw new Error(`This browser cannot encode ${format.toUpperCase()} at ${width}×${height}.`)
}

/** Times of the motion-blur sub-samples for frame i (180° shutter, centred on the frame). */
function subframeTimes(t: number, fps: number, samples: number, duration: number) {
  if (samples <= 1) return [t]
  const shutter = 0.5 / fps
  return Array.from({ length: samples }, (_, k) =>
    Math.min(duration, Math.max(0, t - shutter / 2 + ((k + 0.5) / samples) * shutter)),
  )
}

/**
 * Deterministic offline render: for every frame, evaluate the document at t = i/fps,
 * wait for frame-exact screen content, render, and hand the canvas to WebCodecs.
 * Nothing depends on wall-clock time, so a slow GPU just exports slower — never worse.
 */
export async function exportProject(project: Project, opts: ExportOptions, cb: ExportCallbacks = {}): Promise<ExportResult> {
  const { width, height } = outputSize(project, opts.scale)
  const fps = opts.fps
  const duration = project.settings.duration
  const total = Math.max(1, Math.round(duration * fps))
  const transparent = project.settings.background.kind === 'transparent'
  const started = performance.now()

  const canvas = new OffscreenCanvas(width, height)
  const engine = new Engine({ canvas, width, height, preserveDrawingBuffer: true })
  const provider = new AssetSourceProvider('exact')
  provider.setAssets(project.assets)
  engine.setSources(provider)
  const usedAssets = new Set(
    project.nodes.flatMap((n) => (n.type === 'device' && n.screen.assetId ? [n.screen.assetId] : [])),
  )
  await Promise.all([...usedAssets].map((id) => provider.load(id)))

  const checkAbort = () => {
    if (cb.signal?.aborted) throw new DOMException('Export cancelled', 'AbortError')
  }

  const renderFrame = async (i: number) => {
    const t = i / fps
    const main = evaluate(project, t)
    await engine.prepareSources(main, false)
    const times = subframeTimes(t, fps, opts.motionBlur, duration)
    engine.renderAccumulated(times.map((st) => (st === t ? main : { ...evaluate(project, st), time: t })))
  }

  const base = (project.name || 'mockup').replace(/[^\w\- ]+/g, '').trim() || 'mockup'

  try {
    if (opts.format === 'png') {
      const blob = await exportPngSequence(total, renderFrame, canvas, checkAbort, cb.onProgress)
      return { blob, filename: `${base}-png.zip`, codec: 'png', frames: total, seconds: (performance.now() - started) / 1000 }
    }

    const bitrate = Math.round(width * height * fps * BPP[opts.quality])
    const codec = await pickCodec(opts.format, width, height, bitrate)
    const format =
      opts.format === 'mp4'
        ? new Mp4OutputFormat({ fastStart: opts.fileHandle ? false : 'in-memory' })
        : new WebMOutputFormat()

    let writable: FileSystemWritableFileStream | null = null
    let target: Target
    if (opts.fileHandle) {
      writable = await opts.fileHandle.createWritable()
      target = new StreamTarget(writable as unknown as WritableStream, { chunked: true })
    } else {
      target = new BufferTarget()
    }

    const output = new Output({ format, target })
    const keepAlpha = transparent && opts.format === 'webm'
    const video = new CanvasSource(canvas, {
      codec,
      quality: new Quality({ bitrate, bitrateMode: 'variable' }),
      latencyMode: 'quality',
      keyFrameInterval: 1,
      alpha: keepAlpha ? 'keep' : 'discard',
    })
    output.addVideoTrack(video, { frameRate: fps, canBeTransparent: keepAlpha })
    const audio = await prepareSoundtrack(project, output, opts.format, opts.includeAudio)

    await output.start()
    // Audio is fed concurrently: the muxer interleaves tracks and applies backpressure.
    const audioDone = audio?.feed() ?? Promise.resolve()

    try {
      for (let i = 0; i < total; i++) {
        checkAbort()
        await renderFrame(i)
        await video.add(i / fps, 1 / fps) // resolves when the encoder has room (backpressure)
        cb.onProgress?.(i + 1, total)
      }
      video.close()
      await audioDone
      await output.finalize()
    } catch (err) {
      await output.cancel().catch(() => {})
      await writable?.abort().catch(() => {})
      throw err
    }

    const blob = target instanceof BufferTarget && target.buffer ? new Blob([target.buffer], { type: format.mimeType }) : null
    return {
      blob,
      filename: `${base}${format.fileExtension}`,
      codec,
      frames: total,
      seconds: (performance.now() - started) / 1000,
    }
  } finally {
    provider.dispose()
    engine.dispose()
  }
}

/**
 * The soundtrack: the song (offset, volume, fades) mixed with screen-recording audio, rendered
 * offline and encoded (AAC in MP4, Opus in WebM). Returns null when there is nothing to hear.
 */
async function prepareSoundtrack(project: Project, output: Output, format: ExportFormat, includeRecordingAudio: boolean) {
  if (!project.music && !includeRecordingAudio) return null
  const codec: AudioCodec = format === 'mp4' ? 'aac' : 'opus'
  if (!(await canEncodeAudio(codec, { numberOfChannels: 2, sampleRate: 48000 }))) {
    console.warn(`[export] this browser cannot encode ${codec}; exporting without audio`)
    return null
  }
  const buffer = await mixdown(project, { includeRecordingAudio, sampleRate: 48000 })
  if (!buffer) return null
  const source = new AudioBufferSource({ codec, quality: new Quality({ bitrate: 192_000 }) })
  output.addAudioTrack(source)
  return {
    async feed() {
      await source.add(buffer)
      source.close()
    },
  }
}

async function exportPngSequence(
  total: number,
  renderFrame: (i: number) => Promise<void>,
  canvas: OffscreenCanvas,
  checkAbort: () => void,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const chunks: Uint8Array[] = []
  let zipError: Error | null = null
  const zip = new Zip((err, chunk) => {
    if (err) zipError = err
    else chunks.push(chunk)
  })
  const digits = String(total).length
  for (let i = 0; i < total; i++) {
    checkAbort()
    await renderFrame(i)
    const png = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
    const file = new ZipPassThrough(`frame_${String(i).padStart(Math.max(4, digits), '0')}.png`)
    zip.add(file)
    file.push(png, true)
    if (zipError) throw zipError
    onProgress?.(i + 1, total)
  }
  zip.end()
  return new Blob(chunks as BlobPart[], { type: 'application/zip' })
}
