import { writeFileSync } from 'node:fs'

/**
 * A synthetic 120 BPM song as a 16-bit WAV: soft intro (kicks only) for 4 bars, then a loud
 * section (kicks, hats and a pad). Beats every 0.5 s from 0.25 s, bars every 2 s.
 */
export function writeSong(path: string, { seconds = 24, bpm = 120, first = 0.25, loudFromBar = 4 } = {}) {
  const sr = 44100
  const n = seconds * sr
  const x = new Float32Array(n)
  const beat = 60 / bpm
  let seed = 3
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
  const loudAt = first + loudFromBar * 4 * beat
  for (let i = 0; first + i * beat < seconds; i++) {
    const t0 = first + i * beat
    const loud = t0 >= loudAt
    const amp = (i % 4 === 0 ? 1 : 0.5) * (loud ? 1 : 0.6)
    for (let k = 0; k < 0.15 * sr; k++) {
      const idx = Math.round(t0 * sr) + k
      if (idx >= n) break
      const t = k / sr
      x[idx] += amp * Math.sin(2 * Math.PI * (55 + 60 * Math.exp(-t * 30)) * t) * Math.exp(-t * 18) * (1 - k / (0.15 * sr))
    }
    if (loud) {
      const h = Math.round((t0 + beat / 2) * sr)
      for (let k = 0; k < 0.03 * sr && h + k < n; k++) x[h + k] += 0.12 * rand() * Math.exp(-k / (0.008 * sr))
    }
  }
  for (let i = Math.round(loudAt * sr); i < n; i++) {
    const t = i / sr
    x[i] += 0.2 * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277.2 * t) + Math.sin(2 * Math.PI * 329.6 * t)) / 3
  }
  const data = Buffer.alloc(44 + n * 2)
  data.write('RIFF', 0)
  data.writeUInt32LE(36 + n * 2, 4)
  data.write('WAVEfmt ', 8)
  data.writeUInt32LE(16, 16)
  data.writeUInt16LE(1, 20)
  data.writeUInt16LE(1, 22)
  data.writeUInt32LE(sr, 24)
  data.writeUInt32LE(sr * 2, 28)
  data.writeUInt16LE(2, 32)
  data.writeUInt16LE(16, 34)
  data.write('data', 36)
  data.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i] * 0.8)) * 32767), 44 + i * 2)
  writeFileSync(path, data)
  return { bpm, first, loudAt }
}
