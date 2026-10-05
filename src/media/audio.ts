import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny'
import { analyzeAudio, toMono } from '@/core/music/analyze'
import type { MusicAnalysis, Project, ScreenRegion } from '@/core/schema/project'
import { detectRegions } from '@/core/vision/regions'
import { getBlob } from './assetStore'

/**
 * Browser-side media intelligence: decoding songs (shared by waveform, preview playback and
 * export), analysing them, and extracting colour palettes from screenshots/recordings.
 */

let ctx: AudioContext | null = null
const audioContext = () => (ctx ??= new AudioContext())

const decoded = new Map<string, Promise<AudioBuffer | null>>()

/** Decodes an asset once; every consumer shares the same AudioBuffer. */
export function decodeAsset(assetId: string): Promise<AudioBuffer | null> {
  let p = decoded.get(assetId)
  if (!p) {
    p = getBlob(assetId)
      .then(async (blob) => (blob ? audioContext().decodeAudioData(await blob.arrayBuffer()) : null))
      .catch((err) => {
        console.warn('[audio] cannot decode', assetId, err)
        return null
      })
    decoded.set(assetId, p)
  }
  return p
}

export async function analyzeBlob(blob: Blob): Promise<{ duration: number; analysis: MusicAnalysis }> {
  const buffer = await audioContext().decodeAudioData(await blob.arrayBuffer())
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
  return { duration: buffer.duration, analysis: analyzeAudio(toMono(channels), buffer.sampleRate) }
}

/** Min/max peaks per bucket for drawing a waveform (normalised to the loudest peak). */
export function peaks(buffer: AudioBuffer, buckets: number, from = 0, to = buffer.duration): Float32Array {
  const out = new Float32Array(buckets)
  const data = buffer.getChannelData(0)
  const sr = buffer.sampleRate
  const a = Math.max(0, Math.floor(from * sr))
  const b = Math.min(data.length, Math.floor(to * sr))
  const step = Math.max(1, (b - a) / buckets)
  let max = 1e-6
  for (let i = 0; i < buckets; i++) {
    let m = 0
    const s = Math.floor(a + i * step), e = Math.min(b, Math.floor(a + (i + 1) * step))
    for (let k = s; k < e; k += 4) m = Math.max(m, Math.abs(data[k]))
    out[i] = m
    max = Math.max(max, m)
  }
  for (let i = 0; i < buckets; i++) out[i] /= max
  return out
}

/**
 * What the editor learns from a screenshot/recording's first frame: dominant colours (for
 * "match media" looks) and the UI blocks worth focusing on (for one-click storyboards).
 */
export async function visualOf(blob: Blob, kind: 'image' | 'video'): Promise<{ palette: string[]; regions: ScreenRegion[] }> {
  let source: CanvasImageSource | null = null
  let aspect = 9 / 19.5
  let cleanup = () => {}
  if (kind === 'image') {
    const bmp = await createImageBitmap(blob)
    source = bmp
    aspect = bmp.width / bmp.height
    cleanup = () => bmp.close()
  } else {
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
    try {
      const track = await input.getPrimaryVideoTrack()
      if (track) {
        aspect = track.displayWidth / track.displayHeight
        const frame = await new CanvasSink(track, { width: 90, height: Math.round(90 / aspect), fit: 'fill' }).getCanvas(await track.getFirstTimestamp())
        source = (frame?.canvas as CanvasImageSource) ?? null
      }
    } finally {
      input.dispose()
    }
  }
  if (!source) return { palette: [], regions: [] }
  const w = 90, h = Math.max(8, Math.round(w / aspect))
  const g = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })!
  g.drawImage(source, 0, 0, w, h)
  cleanup()
  const { data } = g.getImageData(0, 0, w, h)
  return { palette: palette(data), regions: detectRegions(data, w, h) }
}

/** Dominant colours (hex), most frequent first, near-duplicates merged. */
function palette(data: Uint8ClampedArray): string[] {
  const counts = new Map<number, { n: number; r: number; gr: number; b: number }>()
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4)
    const c = counts.get(key) ?? { n: 0, r: 0, gr: 0, b: 0 }
    c.n++
    c.r += data[i]
    c.gr += data[i + 1]
    c.b += data[i + 2]
    counts.set(key, c)
  }
  const colours = [...counts.values()].sort((a, b) => b.n - a.n).map((c) => [c.r / c.n, c.gr / c.n, c.b / c.n])
  const picked: number[][] = []
  for (const c of colours) {
    if (picked.every((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) > 48)) picked.push(c)
    if (picked.length === 5) break
  }
  return picked.map((c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`)
}

/** Gain envelope of the music at project time t (volume with fade in/out). */
export function musicGain(project: Project, t: number) {
  const m = project.music
  if (!m) return 0
  const end = project.settings.duration
  const fin = m.fadeIn > 0 ? Math.min(1, t / m.fadeIn) : 1
  const fout = m.fadeOut > 0 ? Math.min(1, Math.max(0, (end - t) / m.fadeOut)) : 1
  return m.volume * fin * fout
}

/**
 * Renders the soundtrack for export: the song (offset, volume, fades) mixed with screen
 * recording audio when requested. Returns null when there is nothing to hear.
 */
export async function mixdown(project: Project, opts: { includeRecordingAudio: boolean; sampleRate?: number }): Promise<AudioBuffer | null> {
  const sampleRate = opts.sampleRate ?? 48000
  const duration = project.settings.duration
  const offline = new OfflineAudioContext(2, Math.max(1, Math.ceil(duration * sampleRate)), sampleRate)
  let sources = 0

  const m = project.music
  const song = m ? await decodeAsset(m.assetId) : null
  if (m && song) {
    const src = offline.createBufferSource()
    src.buffer = song
    const gain = offline.createGain()
    gain.gain.setValueAtTime(m.fadeIn > 0 ? 0 : m.volume, 0)
    if (m.fadeIn > 0) gain.gain.linearRampToValueAtTime(m.volume, Math.min(duration, m.fadeIn))
    if (m.fadeOut > 0) {
      gain.gain.setValueAtTime(m.volume, Math.max(m.fadeIn, duration - m.fadeOut))
      gain.gain.linearRampToValueAtTime(0, duration)
    }
    src.connect(gain).connect(offline.destination)
    src.start(0, Math.min(m.offset, song.duration))
    sources++
  }

  if (opts.includeRecordingAudio) {
    const recordingIds = project.nodes.flatMap((n) => (n.type === 'device' && n.screen.assetId && project.assets[n.screen.assetId]?.hasAudio ? [n.screen.assetId] : []))
    for (const id of recordingIds) {
      const buf = await decodeAsset(id)
      if (!buf) continue
      const src = offline.createBufferSource()
      src.buffer = buf
      // Recordings loop with the screen video; under a song they sit a little lower.
      src.loop = true
      const gain = offline.createGain()
      gain.gain.value = song ? 0.6 : 1
      src.connect(gain).connect(offline.destination)
      src.start(0)
      sources++
    }
  }
  return sources ? offline.startRendering() : null
}

/**
 * Preview playback locked to the playhead. Uses Web Audio (sample-accurate start) and
 * restarts only when the playhead jumps, so normal playback never stutters.
 */
export class MusicPlayer {
  private node: AudioBufferSourceNode | null = null
  private gain: GainNode | null = null
  private startedAt = 0
  private startedT = 0
  private assetId = ''

  /** Project time according to the audio clock while playing (the preview follows it). */
  clock(): number | null {
    return this.node && ctx ? this.startedT + (ctx.currentTime - this.startedAt) : null
  }

  async sync(project: Project, t: number, playing: boolean) {
    const m = project.music
    if (!playing || !m) return this.stop()
    if (this.node && this.assetId !== m.assetId) this.stop()
    const expected = this.clock()
    if (this.node && expected !== null && Math.abs(expected - t) < 0.15) {
      if (this.gain) this.gain.gain.value = musicGain(project, t)
      return
    }
    this.stop()
    const buffer = await decodeAsset(m.assetId)
    if (!buffer) return
    const ac = audioContext()
    if (ac.state === 'suspended') await ac.resume()
    const node = ac.createBufferSource()
    node.buffer = buffer
    const gain = ac.createGain()
    gain.gain.value = musicGain(project, t)
    node.connect(gain).connect(ac.destination)
    const songT = m.offset + t
    if (songT < buffer.duration) node.start(0, songT)
    this.node = node
    this.gain = gain
    this.assetId = m.assetId
    this.startedAt = ac.currentTime
    this.startedT = t
  }

  stop() {
    try { this.node?.stop() } catch { /* already stopped */ }
    this.node?.disconnect()
    this.gain?.disconnect()
    this.node = null
    this.gain = null
  }
}
