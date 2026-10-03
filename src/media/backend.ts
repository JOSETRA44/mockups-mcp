import { parseProject, type Asset, type Project } from '@/core/schema/project'
import * as local from './assetStore'
import { importMedia as importLocal } from './import'

/**
 * Where projects live. Standalone (static hosting / `npm run dev` without a server):
 * IndexedDB in this browser. Connected (served by `unicali serve`): the server's disk
 * workspace, shared live with agents through MCP/CLI.
 */
export interface ProjectSummary { id: string; name: string; updatedAt: number }

export interface Backend {
  readonly kind: 'local' | 'remote'
  list(): Promise<ProjectSummary[]>
  load(id: string): Promise<Project | null>
  save(project: Project): Promise<void>
  create(project: Project): Promise<void>
  remove(id: string): Promise<void>
  /** Stores the file and returns asset metadata (the caller registers it in the project). */
  importFile(projectId: string, file: File): Promise<Asset>
}

const localBackend: Backend = {
  kind: 'local',
  list: async () => (await local.listProjects()).map(({ id, name, updatedAt }) => ({ id, name, updatedAt })),
  load: local.loadProject,
  save: local.saveProject,
  create: local.saveProject,
  remove: local.deleteProject,
  importFile: (_projectId, file) => importLocal(file),
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error?.message ?? `${res.status} ${res.statusText}`)
  }
  return res.json()
}

const remoteBackend: Backend = {
  kind: 'remote',
  list: async () => (await json<{ projects: ProjectSummary[] }>(await fetch('/api/projects'))).projects,
  load: async (id) => {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}`)
    if (res.status === 404) return null
    return parseProject((await json<{ project: Project }>(res)).project)
  },
  save: async (project) => {
    await json(await fetch(`/api/projects/${project.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project, origin: clientId }),
    }))
  },
  create: async (project) => remoteBackend.save(project),
  remove: async (id) => { await json(await fetch(`/api/projects/${id}`, { method: 'DELETE' })) },
  importFile: async (projectId, file) => {
    const res = await fetch(`/api/projects/${projectId}/assets?name=${encodeURIComponent(file.name)}`, { method: 'PUT', body: file })
    return (await json<{ asset: Asset }>(res)).asset
  },
}

/** Identifies this tab so the server does not echo our own saves back to us. */
export const clientId = `editor-${Math.random().toString(36).slice(2, 10)}`

export let backend: Backend = localBackend

/** Called once at startup: switches to the server backend when one is serving this page. */
export async function initBackend(): Promise<Backend> {
  try {
    const res = await fetch('/api/health', { signal: AbortSignal.timeout(1500) })
    if (res.ok && (await res.json()).name === 'unicali') {
      local.setRemoteAssetBase('')
      backend = remoteBackend
    }
  } catch {
    // No server: stay local.
  }
  return backend
}

export interface LiveMessage {
  type: 'snapshot' | 'ack' | 'error'
  project?: Project
  revision?: number
  origin?: string
  message?: string
}

/** Opens the live channel for a project. Reconnects with backoff while the tab is open. */
export function openLive(projectId: string, onMessage: (m: LiveMessage) => void, onStatus: (s: 'live' | 'offline') => void) {
  let ws: WebSocket | null = null
  let closed = false
  let retry = 0
  const connect = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${proto}://${location.host}/api/live?project=${encodeURIComponent(projectId)}&client=${clientId}`)
    ws.onopen = () => { retry = 0; onStatus('live') }
    ws.onmessage = (e) => onMessage(JSON.parse(e.data))
    ws.onclose = () => {
      onStatus('offline')
      if (!closed) setTimeout(connect, Math.min(10_000, 500 * 2 ** retry++))
    }
  }
  connect()
  return {
    send(project: Project) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'put', project }))
      else void backend.save(project)
    },
    close() {
      closed = true
      ws?.close()
    },
  }
}
