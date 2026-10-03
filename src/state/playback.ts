import { getPreset } from '@/core/presets/registry'
import type { Project } from '@/core/schema/project'
import { create } from 'zustand'

/** Transport state lives outside the undoable document. */
interface PlaybackState {
  time: number
  playing: boolean
  loop: boolean
  setTime(t: number): void
  toggle(): void
  pause(): void
  setLoop(v: boolean): void
}

export const usePlayback = create<PlaybackState>()((set) => ({
  time: 0,
  playing: false,
  loop: true,
  setTime: (time) => set({ time: Math.max(0, time) }),
  toggle: () => set((s) => ({ playing: !s.playing })),
  pause: () => set({ playing: false }),
  setLoop: (loop) => set({ loop }),
}))

/**
 * Where to park the playhead when a project opens: just after the first entrance, so the
 * user sees the device instead of an empty frame (entrances start off-camera).
 */
export function cueProject(project: Project) {
  const entrance = project.clips
    .filter((c) => getPreset(c.presetId)?.category === 'entrance')
    .sort((a, b) => a.start - b.start)[0]
  const t = entrance ? Math.min(project.settings.duration, entrance.start + entrance.duration) : 0
  usePlayback.setState({ time: t, playing: false })
}
