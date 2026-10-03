import { produce } from 'immer'
import { temporal } from 'zundo'
import { create } from 'zustand'
import { bakeClip } from '@/core/animation/evaluate'
import { createClip, createProject, uid } from '@/core/factory'
import { getPreset } from '@/core/presets/registry'
import type { Asset, Clip, DeviceNode, Project } from '@/core/schema/project'

export type Selection =
  | { kind: 'scene' }
  | { kind: 'device'; id: string }
  | { kind: 'camera' }
  | { kind: 'clip'; id: string }

interface EditorState {
  project: Project
  selection: Selection
  setProject(p: Project): void
  /** Immutable update through an immer draft; bumps updatedAt. */
  update(recipe: (draft: Project) => void): void
  select(s: Selection): void
  addAsset(asset: Asset, deviceId?: string): void
  addPresetClip(presetId: string, at: number): Clip | null
  updateClip(id: string, recipe: (c: Clip) => void): void
  removeClip(id: string): void
  bake(id: string): void
}

export const firstDevice = (p: Project) => p.nodes.find((n): n is DeviceNode => n.type === 'device')

/** Coalesces rapid edits (slider drags) into one undo step. */
function throttleHistory<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let last = 0
  return (...args: A) => {
    const now = Date.now()
    if (now - last > ms) fn(...args)
    last = now
  }
}

export const useEditor = create<EditorState>()(
  temporal(
    (set, get) => ({
      project: createProject(),
      selection: { kind: 'scene' },

      setProject: (project) => set({ project, selection: { kind: 'scene' } }),

      update: (recipe) =>
        set((s) => ({
          project: produce(s.project, (d) => {
            recipe(d)
            d.updatedAt = Date.now()
          }),
        })),

      select: (selection) => set({ selection }),

      addAsset: (asset, deviceId) =>
        get().update((d) => {
          d.assets[asset.id] = asset
          const dev = d.nodes.find((n): n is DeviceNode => n.type === 'device' && (!deviceId || n.id === deviceId))
          if (dev) dev.screen.assetId = asset.id
          // A screen recording longer than the scene usually means the user wants to show it all.
          if (asset.kind === 'video' && asset.duration && asset.duration > d.settings.duration) {
            d.settings.duration = Math.min(60, Math.ceil(asset.duration * 10) / 10)
          }
        }),

      addPresetClip: (presetId, at) => {
        const preset = getPreset(presetId)
        const { project, selection } = get()
        if (!preset) return null
        let target = 'camera'
        if (preset.target === 'device') {
          const selected = selection.kind === 'device' ? selection.id : null
          target = selected ?? firstDevice(project)?.id ?? ''
          if (!target) return null
        }
        const clip = createClip(presetId, target, Math.max(0, Math.min(at, project.settings.duration - 0.1)))
        get().update((d) => {
          d.clips.push(clip)
          const end = clip.start + clip.duration
          if (end > d.settings.duration) d.settings.duration = Math.ceil(end * 10) / 10
        })
        set({ selection: { kind: 'clip', id: clip.id } })
        return clip
      },

      updateClip: (id, recipe) =>
        get().update((d) => {
          const c = d.clips.find((x) => x.id === id)
          if (c) recipe(c)
        }),

      removeClip: (id) => {
        get().update((d) => {
          d.clips = d.clips.filter((c) => c.id !== id)
        })
        set({ selection: { kind: 'scene' } })
      },

      bake: (id) => {
        const tracks = bakeClip(get().project, id, uid)
        get().update((d) => {
          // A baked channel replaces any older track on the same path.
          const paths = new Set(tracks.map((t) => t.path))
          d.tracks = d.tracks.filter((t) => !paths.has(t.path)).concat(tracks)
          d.clips = d.clips.filter((c) => c.id !== id)
        })
        set({ selection: { kind: 'scene' } })
      },
    }),
    {
      partialize: (s) => ({ project: s.project }),
      limit: 100,
      equality: (a, b) => a.project === b.project,
      handleSet: (handleSet) => throttleHistory(handleSet, 400),
    },
  ),
)

export const undo = () => useEditor.temporal.getState().undo()
export const redo = () => useEditor.temporal.getState().redo()
