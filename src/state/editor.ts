import { produce } from 'immer'
import { temporal } from 'zundo'
import { create } from 'zustand'
import { addAssetToProject } from '@/core/commands/assets'
import { runCommand } from '@/core/commands'
import { notify } from '@/ui/common/toast'
import { createProject } from '@/core/factory'
import type { Asset, Clip, DeviceNode, MusicAnalysis, Project } from '@/core/schema/project'

export type Selection =
  | { kind: 'scene' }
  | { kind: 'device'; id: string }
  | { kind: 'camera' }
  | { kind: 'clip'; id: string }
  | { kind: 'shot'; id: string }
  | { kind: 'music' }

interface EditorState {
  project: Project
  selection: Selection
  setProject(p: Project): void
  /** Immutable update through an immer draft; bumps updatedAt. */
  update(recipe: (draft: Project) => void): void
  select(s: Selection): void
  /** Runs a core command (same API as agents). Errors become toasts; returns the result or null. */
  exec(command: string, args?: unknown): Record<string, unknown> | null
  addAsset(asset: Asset, deviceId?: string, analysis?: MusicAnalysis): void
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

      exec: (command, args) => {
        try {
          const out = runCommand(get().project, command, args)
          set({ project: out.project })
          return out.result ?? {}
        } catch (err) {
          notify((err as Error).message, 'error')
          return null
        }
      },

      addAsset: (asset, deviceId, analysis) =>
        set((s) => ({ project: addAssetToProject(s.project, asset, { deviceId, analysis }) })),

      addPresetClip: (presetId, at) => {
        const { project, selection, exec } = get()
        const target = selection.kind === 'device' ? selection.id : undefined
        const start = Math.max(0, Math.min(at, project.settings.duration - 0.1))
        const out = exec('add_motion', { preset: presetId, target, start })
        if (!out?.clipId) return null
        set({ selection: { kind: 'clip', id: String(out.clipId) } })
        return get().project.clips.find((c) => c.id === out.clipId) ?? null
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
        if (get().exec('bake_motion', { clipId: id })) set({ selection: { kind: 'scene' } })
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
