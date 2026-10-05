import { useEffect } from 'react'
import { create } from 'zustand'
import type { Project } from '@/core/schema/project'
import { backend, clientId, openLive } from '@/media/backend'
import { notify } from '@/ui/common/toast'
import { useEditor } from './editor'
import { cueProject } from './playback'

interface SyncState {
  mode: 'local' | 'remote'
  status: 'local' | 'live' | 'offline' | 'saving'
  /** Timestamp of the last change made by someone else (usually an agent). */
  lastRemoteEdit: number
}

export const useSync = create<SyncState>()(() => ({ mode: 'local', status: 'local', lastRemoteEdit: 0 }))

let applyingRemote = false

/** Replaces the document without recording an undo step (used for remote edits). */
function applyRemote(project: Project) {
  applyingRemote = true
  const temporal = useEditor.temporal.getState()
  temporal.pause()
  useEditor.setState((s) => {
    // Keep the selection if it still exists in the new document.
    const sel = s.selection
    const gone =
      (sel.kind === 'clip' && !project.clips.some((c) => c.id === sel.id)) ||
      (sel.kind === 'device' && !project.nodes.some((n) => n.id === sel.id)) ||
      (sel.kind === 'shot' && !project.shots.some((x) => x.id === sel.id)) ||
      (sel.kind === 'music' && !project.music)
    return { project, selection: gone ? { kind: 'scene' } : sel }
  })
  temporal.resume()
  applyingRemote = false
}

/** Opens a document in the editor (fresh undo history, playhead cued, URL updated). */
export function openInEditor(project: Project) {
  useEditor.getState().setProject(project)
  useEditor.temporal.getState().clear()
  cueProject(project)
  const url = new URL(location.href)
  url.searchParams.set('project', project.id)
  history.replaceState(null, '', url)
}

async function pickInitialProject(): Promise<Project> {
  const wanted = new URLSearchParams(location.search).get('project')
  let doc = wanted ? await backend.load(wanted).catch(() => null) : null
  if (!doc) {
    const rows = await backend.list().catch(() => [])
    if (rows[0]) doc = await backend.load(rows[0].id).catch(() => null)
  }
  if (!doc) {
    doc = useEditor.getState().project
    await backend.create(doc)
  }
  return doc
}

/**
 * Persistence + collaboration. Local mode: debounced autosave to IndexedDB.
 * Remote mode: the document is mirrored to the server over a WebSocket; edits made by
 * agents (MCP/CLI) arrive as snapshots and are applied live.
 */
export function useProjectSync() {
  useEffect(() => {
    let disposed = false
    let timer = 0
    let live: ReturnType<typeof openLive> | null = null
    let liveFor = ''
    let lastNotice = 0
    useSync.setState({ mode: backend.kind, status: backend.kind === 'local' ? 'local' : 'offline' })

    const connectLive = (projectId: string) => {
      if (backend.kind !== 'remote' || liveFor === projectId) return
      live?.close()
      liveFor = projectId
      live = openLive(
        projectId,
        (m) => {
          if (m.type === 'snapshot' && m.project && m.origin !== clientId) {
            const current = useEditor.getState().project
            if (m.project.id !== current.id || m.project.updatedAt === current.updatedAt) return
            applyRemote(m.project)
            if (m.origin !== 'server') {
              useSync.setState({ lastRemoteEdit: Date.now() })
              if (Date.now() - lastNotice > 4000) notify(`Project updated by ${m.origin === 'agent' ? 'an agent' : m.origin}`)
              lastNotice = Date.now()
            }
          } else if (m.type === 'ack') {
            useSync.setState({ status: 'live' })
          } else if (m.type === 'error') {
            notify(m.message ?? 'Sync error', 'error')
          }
        },
        (s) => useSync.setState({ status: s }),
      )
    }

    void pickInitialProject()
      .then((doc) => {
        if (disposed) return
        openInEditor(doc)
        connectLive(doc.id)
      })
      .catch((err) => notify(`Could not open project: ${(err as Error).message}`, 'error'))

    const unsub = useEditor.subscribe((s, prev) => {
      if (s.project === prev.project) return
      if (s.project.id !== prev.project.id) connectLive(s.project.id)
      if (applyingRemote) return
      clearTimeout(timer)
      if (backend.kind === 'remote') useSync.setState({ status: 'saving' })
      timer = window.setTimeout(() => {
        const doc = useEditor.getState().project
        if (backend.kind === 'remote' && live && liveFor === doc.id) live.send(doc)
        else void backend.save(doc).catch((err) => notify(`Save failed: ${(err as Error).message}`, 'error'))
      }, backend.kind === 'remote' ? 250 : 600)
    })

    return () => {
      disposed = true
      unsub()
      clearTimeout(timer)
      live?.close()
    }
  }, [])
}
