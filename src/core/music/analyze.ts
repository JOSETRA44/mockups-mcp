import type { MusicAnalysis, MusicSection } from '../schema/project'

/**
 * Song analysis: tempo, beats, downbeats (4/4 bars) and energy sections.
 * Pure TypeScript on raw PCM so it runs in the editor, in headless Chrome and in tests.
 *
 * Pipeline
 *  1. onset strength  = spectral flux of a log-magnitude STFT (what changes, not how loud)
 *  2. tempo           = autocorrelation of the onset curve, weighted by a log-normal prior at 120 BPM
 *  3. beats           = dynamic programming beat tracker (Ellis 2007): onsets + regular spacing
 *  4. downbeats       = the 4/4 phase whose beats carry the most low-frequency attack (kick)
 *  5. sections        = novelty between consecutive 4-bar blocks of energy features
 */
export const ANALYZER = 'unicali-beat-1'

const TARGET_RATE = 22050
const FRAME = 1024
const HOP = 256

/** In-place iterative radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2
        const tr = re[b] * cr - im[b] * ci
        const ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
}

const mean = (a: ArrayLike<number>, from = 0, to = a.length) => {
  let s = 0
  for (let i = from; i < to; i++) s += a[i]
  return to > from ? s / (to - from) : 0
}

function std(a: ArrayLike<number>) {
  const m = mean(a)
  let s = 0
  for (let i = 0; i < a.length; i++) s += (a[i] - m) ** 2
  return Math.sqrt(s / Math.max(1, a.length))
}

interface Features {
  rate: number
  /** Frames per second of the feature curves. */
  fps: number
  onset: Float64Array
  low: Float64Array
  rms: Float64Array
}

function features(samples: Float32Array, sampleRate: number): Features {
  const factor = Math.max(1, Math.round(sampleRate / TARGET_RATE))
  const rate = sampleRate / factor
  const n = Math.floor(samples.length / factor)
  const x = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let k = 0; k < factor; k++) s += samples[i * factor + k]
    x[i] = s / factor
  }

  const frames = Math.max(0, Math.floor((n - FRAME) / HOP) + 1)
  const win = new Float64Array(FRAME).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1)))
  const maxBin = Math.min(FRAME / 2, Math.round((8000 * FRAME) / rate))
  const lowBin = Math.max(2, Math.round((180 * FRAME) / rate))
  const flux = new Float64Array(frames)
  const low = new Float64Array(frames)
  const rms = new Float64Array(frames)
  // SuperFlux (Böck & Widmer 2013): compare with the frame two hops back, max-filtered
  // across frequency, so decays, vibrato and tails do not register as new attacks.
  const history: Float64Array[] = []
  const re = new Float64Array(FRAME), im = new Float64Array(FRAME)

  for (let t = 0; t < frames; t++) {
    const off = t * HOP
    let e = 0
    for (let i = 0; i < FRAME; i++) {
      const v = x[off + i]
      e += v * v
      re[i] = v * win[i]
      im[i] = 0
    }
    rms[t] = Math.sqrt(e / FRAME)
    fft(re, im)
    const cur = new Float64Array(maxBin)
    for (let k = 1; k < maxBin; k++) cur[k] = Math.log1p(10 * Math.hypot(re[k], im[k]))
    const ref = history.length >= 2 ? history[history.length - 2] : history[history.length - 1]
    let f = 0, lf = 0
    if (ref) {
      for (let k = 1; k < maxBin; k++) {
        const m = Math.max(ref[k - 1] ?? 0, ref[k], ref[k + 1] ?? 0)
        const d = cur[k] - m
        if (d > 0) {
          f += d
          if (k <= lowBin) lf += d
        }
      }
    }
    flux[t] = f
    low[t] = lf
    history.push(cur)
    if (history.length > 2) history.shift()
  }

  // Remove the slow trend (a local mean over ~0.4 s) so only attacks remain, then combine
  // broadband flux with low-band flux. Kicks/bass define the pulse in most pop/electronic
  // music; without the low band, off-beat hi-hats (broadband noise) would win.
  const fps = rate / HOP
  const w = Math.max(1, Math.round(0.2 * fps))
  const detrend = (src: Float64Array) => {
    const out = new Float64Array(frames)
    for (let t = 0; t < frames; t++) out[t] = Math.max(0, src[t] - mean(src, Math.max(0, t - w), Math.min(frames, t + w + 1)))
    const sd = std(out) || 1
    for (let t = 0; t < frames; t++) out[t] /= sd
    return out
  }
  const broad = detrend(flux)
  const lowN = detrend(low)
  const onset = new Float64Array(frames)
  for (let t = 0; t < frames; t++) onset[t] = broad[t] + 1.5 * lowN[t]
  const sd = std(onset) || 1
  for (let t = 0; t < frames; t++) onset[t] /= sd
  return { rate, fps, onset, low: lowN, rms }
}

function estimatePeriod(onset: Float64Array, fps: number): number {
  const minLag = Math.floor((60 / 190) * fps)
  const maxLag = Math.ceil((60 / 60) * fps)
  const score = new Float64Array(maxLag + 2)
  let best = -1, bestLag = 0
  for (let lag = minLag; lag <= maxLag; lag++) {
    let r = 0
    for (let t = lag; t < onset.length; t++) r += onset[t] * onset[t - lag]
    r /= onset.length - lag
    const bpm = (60 * fps) / lag
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2)
    score[lag] = r * prior
    if (score[lag] > best) { best = score[lag]; bestLag = lag }
  }
  if (bestLag <= minLag || bestLag >= maxLag) return bestLag
  // Parabolic interpolation for sub-frame precision.
  const a = score[bestLag - 1], b = score[bestLag], c = score[bestLag + 1]
  const denom = a - 2 * b + c
  return denom === 0 ? bestLag : bestLag + (0.5 * (a - c)) / denom
}

/** Ellis-style dynamic programming beat tracker. Returns beat frame indices. */
function trackBeats(onset: Float64Array, period: number, tightness = 400): number[] {
  const n = onset.length
  const score = new Float64Array(n)
  const back = new Int32Array(n).fill(-1)
  const lo = Math.round(period / 2), hi = Math.round(2 * period)
  for (let t = 0; t < n; t++) {
    let best = 0, from = -1
    for (let tau = t - hi; tau <= t - lo; tau++) {
      if (tau < 0) continue
      const s = score[tau] - tightness * Math.log((t - tau) / period) ** 2
      if (from < 0 || s > best) { best = s; from = tau }
    }
    score[t] = onset[t] + (from >= 0 ? best : 0)
    back[t] = from
  }
  // Start from the best-scoring frame within the last period.
  let t = n - 1, bestEnd = -Infinity
  for (let i = Math.max(0, n - Math.round(period)); i < n; i++) if (score[i] > bestEnd) { bestEnd = score[i]; t = i }
  const beats: number[] = []
  while (t >= 0) {
    beats.push(t)
    t = back[t]
  }
  return beats.reverse()
}

function peakNear(a: Float64Array, t: number, r = 2) {
  let m = 0
  for (let i = Math.max(0, t - r); i <= Math.min(a.length - 1, t + r); i++) m = Math.max(m, a[i])
  return m
}

function sections(bars: number[], end: number, energyAt: (from: number, to: number) => number[]): MusicSection[] {
  if (bars.length < 2) return [{ start: 0, end, energy: 1, label: 'full' }]
  const edges = [...bars, end]
  const feats = bars.map((b, i) => energyAt(b, edges[i + 1]))
  const dims = feats[0].length
  // z-normalise each feature across bars.
  for (let d = 0; d < dims; d++) {
    const col = feats.map((f) => f[d])
    const m = mean(col), s = std(col) || 1
    feats.forEach((f) => (f[d] = (f[d] - m) / s))
  }
  const block = 4
  const novelty = bars.map((_, i) => {
    if (i < 2 || i > bars.length - 2) return 0
    const a = feats.slice(Math.max(0, i - block), i), b = feats.slice(i, Math.min(bars.length, i + block))
    let dist = 0
    for (let d = 0; d < dims; d++) dist += (mean(a.map((f) => f[d])) - mean(b.map((f) => f[d]))) ** 2
    return Math.sqrt(dist)
  })
  const thr = mean(novelty) + std(novelty)
  const cuts: number[] = [0]
  // Greedy: strongest peaks first, at least one 4-bar phrase apart.
  const order = novelty.map((v, i) => [v, i] as const).filter(([v]) => v > thr).sort((x, y) => y[0] - x[0])
  for (const [, i] of order) if (cuts.every((c) => Math.abs(c - i) >= block)) cuts.push(i)
  cuts.sort((x, y) => x - y)

  const raw = cuts.map((c, k) => {
    const to = k + 1 < cuts.length ? cuts[k + 1] : bars.length
    const startT = k === 0 ? 0 : bars[c]
    const endT = to < bars.length ? bars[to] : end
    const e = mean(feats.slice(c, to).map((f) => f[0]))
    return { start: startT, end: endT, e }
  })
  const lo = Math.min(...raw.map((r) => r.e)), hi = Math.max(...raw.map((r) => r.e))
  return raw.map((r, i) => {
    const energy = hi > lo ? (r.e - lo) / (hi - lo) : 1
    let label = energy > 0.66 ? 'peak' : energy < 0.33 ? 'calm' : 'build'
    if (i === 0 && energy < 0.5) label = 'intro'
    else if (i === raw.length - 1 && raw.length > 1 && energy < 0.5) label = 'outro'
    return { start: +r.start.toFixed(3), end: +r.end.toFixed(3), energy: +energy.toFixed(3), label }
  })
}

export function analyzeAudio(samples: Float32Array, sampleRate: number): MusicAnalysis {
  const duration = samples.length / sampleRate
  const f = features(samples, sampleRate)
  const empty: MusicAnalysis = { analyzer: ANALYZER, duration, bpm: 0, beats: [], bars: [], sections: [{ start: 0, end: duration, energy: 1, label: 'full' }] }
  if (f.onset.length < f.fps * 3) return empty

  const period = estimatePeriod(f.onset, f.fps)
  if (!period) return empty
  const beatFrames = trackBeats(f.onset, period)
  // Frame t is centred FRAME/2 samples after its start.
  const toTime = (t: number) => (t * HOP + FRAME / 2) / f.rate
  const beats = beatFrames.map((t) => +toTime(t).toFixed(4))

  let phase = 0, bestAccent = -Infinity
  for (let p = 0; p < 4; p++) {
    let s = 0
    for (let i = p; i < beatFrames.length; i += 4) s += peakNear(f.low, beatFrames[i]) + 0.25 * peakNear(f.onset, beatFrames[i])
    s /= Math.max(1, Math.ceil((beatFrames.length - p) / 4))
    if (s > bestAccent) { bestAccent = s; phase = p }
  }
  const bars = beats.filter((_, i) => i >= phase && (i - phase) % 4 === 0)

  const frameAt = (t: number) => Math.max(0, Math.min(f.rms.length, Math.round((t * f.rate - FRAME / 2) / HOP)))
  const energyAt = (from: number, to: number) => {
    const a = frameAt(from), b = Math.max(a + 1, frameAt(to))
    return [mean(f.rms, a, b), mean(f.onset, a, b), mean(f.low, a, b)]
  }

  return {
    analyzer: ANALYZER,
    duration: +duration.toFixed(3),
    bpm: +((60 * f.fps) / period).toFixed(2),
    beats,
    bars,
    sections: sections(bars, duration, energyAt),
  }
}

/** Mixes interleaved/multi-channel PCM down to mono. */
export function toMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]
  const n = channels[0].length
  const out = new Float32Array(n)
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] / channels.length
  return out
}
