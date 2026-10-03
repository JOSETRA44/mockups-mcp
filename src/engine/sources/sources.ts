import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny'
import { CanvasTexture, LinearFilter, SRGBColorSpace, Texture, VideoTexture } from 'three'
import type { Asset } from '@/core/schema/project'
import { getBlob } from '@/media/assetStore'
import { videoTimeAt, type ScreenSource, type SourceProvider } from './types'

function configure<T extends Texture>(tex: T): T {
  tex.colorSpace = SRGBColorSpace
  tex.flipY = false
  tex.generateMipmaps = false
  tex.minFilter = LinearFilter
  tex.magFilter = LinearFilter
  return tex
}

export async function createImageSource(blob: Blob): Promise<ScreenSource> {
  const bmp = await createImageBitmap(blob)
  const texture = configure(new Texture(bmp))
  texture.needsUpdate = true
  return {
    texture,
    width: bmp.width,
    height: bmp.height,
    prepare() {},
    dispose() {
      texture.dispose()
      bmp.close()
    },
  }
}

/** Preview: a real <video> element kept in sync with the playhead (cheap, may drift slightly). */
export async function createPreviewVideoSource(blob: Blob, asset: Asset): Promise<ScreenSource> {
  const url = URL.createObjectURL(blob)
  const video = document.createElement('video')
  video.src = url
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.crossOrigin = 'anonymous'
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve()
    video.onerror = () => reject(new Error(`Cannot play ${asset.name}`))
  })
  const texture = configure(new VideoTexture(video))
  const duration = asset.duration ?? video.duration
  return {
    texture,
    width: video.videoWidth,
    height: video.videoHeight,
    prepare(t, playing) {
      const vt = videoTimeAt(t, duration)
      if (playing) {
        if (video.paused) void video.play().catch(() => {})
        if (Math.abs(video.currentTime - vt) > 0.2) video.currentTime = vt
      } else {
        if (!video.paused) video.pause()
        if (Math.abs(video.currentTime - vt) > 1 / 240 && !video.seeking) video.currentTime = vt
      }
    },
    dispose() {
      video.pause()
      texture.dispose()
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
    },
  }
}

/**
 * Export: frame-exact decoding with WebCodecs (via Mediabunny). `prepare(t)` awaits
 * the decoded frame for that exact timestamp — no seeking races, no dropped frames.
 */
export async function createExactVideoSource(blob: Blob, asset: Asset): Promise<ScreenSource> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
  const track = await input.getPrimaryVideoTrack()
  if (!track) throw new Error(`${asset.name} has no video track`)
  const sink = new CanvasSink(track, { poolSize: 2 })
  const duration = asset.duration ?? (await track.computeDuration())
  const first = await sink.getCanvas(await track.getFirstTimestamp())
  const texture = configure(new CanvasTexture(first?.canvas ?? new OffscreenCanvas(2, 2)))
  let lastVt = -1
  return {
    texture,
    width: track.displayWidth,
    height: track.displayHeight,
    async prepare(t) {
      const vt = videoTimeAt(t, duration)
      if (Math.abs(vt - lastVt) < 1e-6) return
      lastVt = vt
      const frame = await sink.getCanvas(vt)
      if (frame) {
        texture.image = frame.canvas
        texture.needsUpdate = true
      }
    },
    dispose() {
      texture.dispose()
      input.dispose()
    },
  }
}

/** Lazily loads one ScreenSource per asset. `mode` picks preview vs. frame-exact video. */
export class AssetSourceProvider implements SourceProvider {
  private sources = new Map<string, ScreenSource>()
  private pending = new Map<string, Promise<ScreenSource | null>>()
  private assets: Record<string, Asset> = {}
  private readonly mode: 'preview' | 'exact'
  private readonly onReady?: () => void

  constructor(mode: 'preview' | 'exact', onReady?: () => void) {
    this.mode = mode
    this.onReady = onReady
  }

  setAssets(assets: Record<string, Asset>) {
    this.assets = assets
    for (const [id, src] of this.sources) {
      if (!assets[id]) {
        src.dispose()
        this.sources.delete(id)
      }
    }
  }

  get(assetId: string): ScreenSource | null {
    const hit = this.sources.get(assetId)
    if (hit) return hit
    if (!this.pending.has(assetId)) void this.load(assetId)
    return null
  }

  /** Resolves when the source is ready (used by export to preload everything). */
  load(assetId: string): Promise<ScreenSource | null> {
    const existing = this.sources.get(assetId)
    if (existing) return Promise.resolve(existing)
    const inflight = this.pending.get(assetId)
    if (inflight) return inflight
    const p = (async () => {
      const asset = this.assets[assetId]
      const blob = asset ? await getBlob(assetId) : null
      if (!asset || !blob) return null
      const src =
        asset.kind === 'image'
          ? await createImageSource(blob)
          : this.mode === 'exact'
            ? await createExactVideoSource(blob, asset)
            : await createPreviewVideoSource(blob, asset)
      this.sources.set(assetId, src)
      this.onReady?.()
      return src
    })()
      .catch((err) => {
        console.error('[sources]', err)
        return null
      })
      .finally(() => this.pending.delete(assetId))
    this.pending.set(assetId, p)
    return p
  }

  dispose() {
    for (const s of this.sources.values()) s.dispose()
    this.sources.clear()
  }
}
