import { z } from 'zod'
import { fitToMusic } from '../music/sync'
import type { MusicAnalysis } from '../schema/project'
import { CommandError, defineCommand, edit } from './types'

const needMusic = (p: { music: unknown }) => {
  if (!p.music) throw new CommandError('CONFLICT', 'The project has no music. Import an audio file (mp3, wav, m4a, ogg) first.')
}

export const setMusic = defineCommand({
  name: 'set_music',
  summary: 'Adjust the song: start point, volume, fades, accents',
  description:
    'offset = song time (s) that plays at the start of the video ("start at the chorus": use a section start from get_project). ' +
    'accents: off | subtle | strong — tiny camera pushes on downbeats of high-energy sections only.',
  args: z.object({
    offset: z.number().min(0).optional(),
    volume: z.number().min(0).max(2).optional(),
    fadeIn: z.number().min(0).max(10).optional(),
    fadeOut: z.number().min(0).max(10).optional(),
    accents: z.enum(['off', 'subtle', 'strong']).optional(),
  }),
  run: (p, a) => {
    needMusic(p)
    return edit(p, (d) => {
      for (const [k, v] of Object.entries(a)) if (v !== undefined) (d.music as Record<string, unknown>)[k] = v
    })
  },
})

export const removeMusic = defineCommand({
  name: 'remove_music',
  summary: 'Remove the song',
  description: 'Removes the music track (the audio file stays in the project assets).',
  args: z.object({}),
  run: (p) => edit(p, (d) => { d.music = null }),
})

export const setTempo = defineCommand({
  name: 'set_tempo',
  summary: 'Correct the detected beat grid',
  description:
    'Fixes analysis mistakes. bpm + firstBeat rebuild a steady grid; shiftDownbeat moves bar starts by N beats (when bars start on the wrong beat); ' +
    'nudge shifts every beat/bar by seconds (when the grid is slightly early/late).',
  args: z.object({
    bpm: z.number().min(40).max(240).optional(),
    firstBeat: z.number().min(0).optional().describe('Song time of a beat to anchor the rebuilt grid (with bpm)'),
    shiftDownbeat: z.number().int().min(-3).max(3).optional(),
    nudge: z.number().min(-1).max(1).optional(),
  }),
  run: (p, a) => {
    needMusic(p)
    const an = p.music!.analysis
    if (!an) throw new CommandError('CONFLICT', 'The song has not been analysed yet.')
    let beats = [...an.beats]
    let bars = [...an.bars]
    let bpm = an.bpm
    if (a.bpm) {
      bpm = a.bpm
      const step = 60 / bpm
      const anchor = a.firstBeat ?? beats[0] ?? 0
      const start = anchor - Math.floor(anchor / step) * step
      beats = []
      for (let t = start; t < an.duration; t += step) beats.push(+t.toFixed(4))
      const anchorIndex = beats.findIndex((t) => Math.abs(t - anchor) < step / 2)
      bars = beats.filter((_, i) => (i - anchorIndex) % 4 === 0)
    }
    if (a.shiftDownbeat) {
      const i0 = beats.findIndex((t) => Math.abs(t - bars[0]) < 1e-3)
      const phase = (((i0 + a.shiftDownbeat) % 4) + 4) % 4
      bars = beats.filter((_, i) => i % 4 === phase)
    }
    if (a.nudge) {
      beats = beats.map((t) => +(t + a.nudge!).toFixed(4)).filter((t) => t >= 0)
      bars = bars.map((t) => +(t + a.nudge!).toFixed(4)).filter((t) => t >= 0)
    }
    const analysis: MusicAnalysis = { ...an, bpm, beats, bars }
    return edit(p, (d) => { d.music!.analysis = analysis })
  },
})

export const fitToMusicCmd = defineCommand({
  name: 'fit_to_music',
  summary: 'Align the story to the song (shots on bars, length on phrases)',
  description:
    'Moves shot boundaries onto bars (preferring section changes), makes the total length a whole number of phrases, lands entrance motions on the first downbeat, ' +
    'starts other motions on beats, and fades the song out on the last bar. Keeps shot order and relative lengths. Safe to re-run; undo restores.',
  args: z.object({
    phrase: z.number().int().min(1).max(16).default(4).describe('Bars per phrase for the total length (4 = typical pop phrase)'),
    sectionSnap: z.boolean().default(true),
  }),
  run: (p, a) => {
    needMusic(p)
    try {
      const { project, report } = fitToMusic(p, a)
      return { project, result: { ...report } }
    } catch (err) {
      throw new CommandError('CONFLICT', (err as Error).message)
    }
  },
})
