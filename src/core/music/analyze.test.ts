import { describe, expect, it } from 'vitest'
import { analyzeAudio } from './analyze'

/**
 * Synthetic 4/4 track: kick on every beat (accented downbeats), hi-hats on off-beats,
 * and a loud pad from bar 9 on, so tempo, phase, bars and a section change are all known.
 */
function synth({ bpm = 120, seconds = 32, firstBeat = 0.37, loudFromBar = 8, sr = 44100 } = {}) {
  const out = new Float32Array(seconds * sr)
  const beat = 60 / bpm
  let seed = 7
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
  for (let i = 0; firstBeat + i * beat < seconds; i++) {
    const t0 = firstBeat + i * beat
    const accent = i % 4 === 0 ? 1 : 0.45
    for (let k = 0; k < 0.15 * sr; k++) {
      const idx = Math.round(t0 * sr) + k
      if (idx >= out.length) break
      const t = k / sr
      // Tapered decay, like a real kick sample.
      out[idx] += accent * Math.sin(2 * Math.PI * (55 + 60 * Math.exp(-t * 30)) * t) * Math.exp(-t * 18) * (1 - k / (0.15 * sr))
    }
    const hat = Math.round((t0 + beat / 2) * sr)
    for (let k = 0; k < 0.03 * sr && hat + k < out.length; k++) out[hat + k] += 0.15 * rand() * Math.exp(-k / (0.008 * sr))
  }
  const loudStart = Math.round((firstBeat + loudFromBar * 4 * beat) * sr)
  for (let i = loudStart; i < out.length; i++) {
    const t = i / sr
    out[i] += 0.25 * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277 * t) + Math.sin(2 * Math.PI * 330 * t)) / 3 + 0.05 * rand()
  }
  return { out, sr, beat, firstBeat, loudAt: firstBeat + loudFromBar * 4 * beat }
}

describe('analyzeAudio', () => {
  const s = synth()
  const a = analyzeAudio(s.out, s.sr)

  it('finds the tempo', () => {
    expect(a.bpm).toBeGreaterThan(118)
    expect(a.bpm).toBeLessThan(122)
  })

  it('places beats on the kicks', () => {
    const errors = a.beats.map((t) => {
      const k = Math.round((t - s.firstBeat) / s.beat)
      return Math.abs(t - (s.firstBeat + k * s.beat))
    })
    const good = errors.filter((e) => e < 0.03).length
    expect(good / errors.length).toBeGreaterThan(0.9)
  })

  it('aligns bars with the accented downbeats', () => {
    expect(a.bars.length).toBeGreaterThan(10)
    for (const b of a.bars.slice(1, -1)) {
      const beatIndex = Math.round((b - s.firstBeat) / s.beat)
      expect(beatIndex % 4).toBe(0)
    }
  })

  it('detects the section change where the pad comes in', () => {
    const boundaries = a.sections.slice(1).map((x) => x.start)
    expect(boundaries.some((t) => Math.abs(t - s.loudAt) < 4 * s.beat + 0.05)).toBe(true)
    const last = a.sections[a.sections.length - 1]
    expect(last.energy).toBeGreaterThan(a.sections[0].energy)
  })

  it('handles silence and very short input', () => {
    expect(analyzeAudio(new Float32Array(44100), 44100).beats).toEqual([])
    expect(analyzeAudio(new Float32Array(10), 44100).bpm).toBe(0)
  })
})
