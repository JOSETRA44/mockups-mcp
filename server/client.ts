import type { Project } from '../src/core/schema/project'
import { baseUrl, loadConfig, type ServerConfig } from './config'
import type { ExportRequest, FramesRequest } from './renderer'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
    this.name = 'ApiError'
  }
}

/** Typed client for the Unicali HTTP API. The MCP server and CLI use nothing else. */
export class UnicaliClient {
  readonly base: string
  constructor(base: string) {
    this.base = base
  }

  private async req<T>(method: string, path: string, body?: unknown, raw = false): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { code: 'HTTP', message: res.statusText } }))
      throw new ApiError(res.status, err.error?.code ?? 'HTTP', err.error?.message ?? res.statusText)
    }
    return (raw ? Buffer.from(await res.arrayBuffer()) : await res.json()) as T
  }

  health() { return this.req<{ ok: boolean; name: string; version: string; home: string; url: string }>('GET', '/api/health') }
  catalog() { return this.req<Record<string, unknown>>('GET', '/api/catalog') }
  listProjects() { return this.req<{ projects: { id: string; name: string; updatedAt: number; revision: number; format: string; duration: number }[] }>('GET', '/api/projects') }
  createProject(name?: string, template?: string) { return this.req<{ project: Project; revision: number }>('POST', '/api/projects', { name, template }) }
  getProject(id: string) { return this.req<{ project: Project; revision: number }>('GET', `/api/projects/${id}`) }
  putProject(id: string, project: Project, origin = 'agent') { return this.req<{ revision: number }>('PUT', `/api/projects/${id}`, { project, origin }) }
  deleteProject(id: string) { return this.req<{ ok: true }>('DELETE', `/api/projects/${id}`) }
  describe(id: string) { return this.req<Record<string, unknown>>('GET', `/api/projects/${id}/describe`) }
  exec(id: string, command: string, args: unknown) {
    return this.req<{ revision: number; result?: Record<string, unknown>; summary: Record<string, unknown> }>('POST', `/api/projects/${id}/commands`, { command, args })
  }
  batch(id: string, batch: { command: string; args?: unknown }[]) {
    return this.req<{ revision: number; result?: { results: unknown[] }; summary: Record<string, unknown> }>('POST', `/api/projects/${id}/commands`, { batch })
  }
  undo(id: string) { return this.req<{ revision: number; summary: Record<string, unknown> }>('POST', `/api/projects/${id}/undo`, {}) }
  redo(id: string) { return this.req<{ revision: number; summary: Record<string, unknown> }>('POST', `/api/projects/${id}/redo`, {}) }
  sample(id: string, times: number[]) { return this.req<{ samples: unknown[] }>('POST', `/api/projects/${id}/sample`, { times }) }
  importFile(id: string, path: string, opts: { deviceId?: string; assign?: boolean; name?: string } = {}) {
    return this.req<{ asset: Record<string, unknown>; revision: number }>('POST', `/api/projects/${id}/import`, { path, ...opts })
  }
  frames(id: string, req: Partial<FramesRequest> & { outputPath?: string; overwrite?: boolean }) {
    return this.req<Buffer>('POST', `/api/projects/${id}/frames`, req, true)
  }
  export(id: string, req: Partial<ExportRequest> & { outputPath?: string; overwrite?: boolean }) {
    return this.req<{ path: string; filename: string; codec: string; frames: number; seconds: number; bytes: number; format: string }>('POST', `/api/projects/${id}/export`, req)
  }
}

async function isUnicali(url: string) {
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) })
    return res.ok && (await res.json()).name === 'unicali'
  } catch {
    return false
  }
}

/**
 * Connects to a running Unicali server, or starts one in-process. Reusing a running
 * server means an editor tab open on it sees agent edits live.
 */
export async function connect(opts: { autostart?: boolean; config?: Partial<ServerConfig> } = {}) {
  const config = loadConfig(opts.config)
  const url = baseUrl(config)
  if (await isUnicali(url)) return { client: new UnicaliClient(url), server: null }
  if (opts.autostart === false) throw new Error(`No Unicali server at ${url}. Start one with: npm run serve`)
  const { startServer } = await import('./http')
  const server = await startServer(config)
  return { client: new UnicaliClient(server.url), server }
}
