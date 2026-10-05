import { EventEmitter } from 'node:events'
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { runCommand, type CommandContext } from '../src/core/commands'
import { addAssetToProject } from '../src/core/commands/assets'
import { createProject, uid } from '../src/core/factory'
import { parseProject, type Asset, type MusicAnalysis, type Project, type ScreenRegion } from '../src/core/schema/project'
import { MEDIA_TYPES, probeFile } from './probe'

export interface ProjectChange {
  projectId: string
  project: Project
  revision: number
  /** Who made the change: a client id, "agent", "server"... Clients skip their own echoes. */
  origin: string
}

interface Entry {
  project: Project
  revision: number
  /** Previous versions, newest last (agent-side undo). */
  history: Project[]
  future: Project[]
}

const HISTORY_LIMIT = 50

/**
 * Projects on disk:
 *   <home>/projects/<id>/project.json
 *   <home>/projects/<id>/assets/<assetId>.<ext>
 *   <home>/projects/<id>/renders/
 * One in-memory entry per open project holds the revision counter and undo history.
 */
export class Workspace extends EventEmitter<{ change: [ProjectChange]; deleted: [string] }> {
  readonly home: string
  private entries = new Map<string, Entry>()
  private assetIndex = new Map<string, string>()
  private writeQueue = new Map<string, Promise<void>>()
  /**
   * Optional media analysis (palette for images/videos, beats for songs), provided by the
   * server through the headless renderer so agents get the same analysis as the editor.
   */
  enrich: ((assetId: string, kind: Asset['kind']) => Promise<{ palette?: string[]; regions?: ScreenRegion[]; analysis?: MusicAnalysis }>) | null = null

  constructor(home: string) {
    super()
    this.home = home
  }

  get projectsDir() { return join(this.home, 'projects') }
  projectDir(id: string) { return join(this.projectsDir, safeId(id)) }
  rendersDir(id: string) { return join(this.projectDir(id), 'renders') }

  async init() {
    await mkdir(this.projectsDir, { recursive: true })
    for (const id of await this.ids()) {
      const dir = join(this.projectDir(id), 'assets')
      if (!existsSync(dir)) continue
      for (const f of await readdir(dir)) this.assetIndex.set(basename(f, extname(f)), join(dir, f))
    }
  }

  private async ids() {
    const out: string[] = []
    for (const d of await readdir(this.projectsDir, { withFileTypes: true })) {
      if (d.isDirectory() && existsSync(join(this.projectsDir, d.name, 'project.json'))) out.push(d.name)
    }
    return out
  }

  async list() {
    const rows = await Promise.all(
      (await this.ids()).map(async (id) => {
        try {
          const { project, revision } = await this.get(id)
          return { id, name: project.name, updatedAt: project.updatedAt, revision, format: `${project.settings.width}x${project.settings.height}`, duration: project.settings.duration }
        } catch {
          return null
        }
      }),
    )
    return rows.filter((r) => r !== null).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async get(id: string): Promise<{ project: Project; revision: number }> {
    const cached = this.entries.get(id)
    if (cached) return cached
    const file = join(this.projectDir(id), 'project.json')
    if (!existsSync(file)) throw new NotFoundError(`No project "${id}". Use list_projects or create_project.`)
    const project = parseProject(JSON.parse(await readFile(file, 'utf8')))
    const entry: Entry = { project, revision: 1, history: [], future: [] }
    this.entries.set(id, entry)
    return entry
  }

  async create(name?: string, template?: string): Promise<{ project: Project; revision: number }> {
    let project = createProject(name ?? 'Untitled project')
    if (template) project = runCommand(project, 'apply_template', { template }).project
    await mkdir(join(this.projectDir(project.id), 'assets'), { recursive: true })
    this.entries.set(project.id, { project, revision: 1, history: [], future: [] })
    await this.persist(project)
    this.emit('change', { projectId: project.id, project, revision: 1, origin: 'server' })
    return { project, revision: 1 }
  }

  /**
   * Replaces the project document. Last writer wins; the revision lets clients detect
   * that someone else (often an agent) changed the project since they last synced.
   */
  async put(id: string, project: Project, origin: string, opts: { recordHistory?: boolean } = {}) {
    const parsed = parseProject(project)
    if (parsed.id !== id) throw new Error('Project id mismatch')
    const entry = await this.get(id).catch(() => null)
    const e: Entry = (entry as Entry | null) ?? { project: parsed, revision: 0, history: [], future: [] }
    if (opts.recordHistory !== false && entry) {
      e.history.push(e.project)
      if (e.history.length > HISTORY_LIMIT) e.history.shift()
      e.future = []
    }
    e.project = parsed
    e.revision += 1
    this.entries.set(id, e)
    await this.persist(parsed)
    this.emit('change', { projectId: id, project: parsed, revision: e.revision, origin })
    return { project: parsed, revision: e.revision }
  }

  /** Runs a core command (or batch) server-side and saves the result. */
  async exec(id: string, fn: (p: Project, ctx: CommandContext) => { project: Project; result?: unknown }, origin = 'agent') {
    const { project } = await this.get(id)
    const out = fn(project, { newId: uid })
    const saved = await this.put(id, out.project, origin)
    return { ...saved, result: out.result }
  }

  async undo(id: string, origin = 'agent') { return this.step(id, 'undo', origin) }
  async redo(id: string, origin = 'agent') { return this.step(id, 'redo', origin) }

  private async step(id: string, dir: 'undo' | 'redo', origin: string) {
    await this.get(id)
    const e = this.entries.get(id)!
    const from = dir === 'undo' ? e.history : e.future
    const to = dir === 'undo' ? e.future : e.history
    const prev = from.pop()
    if (!prev) throw new Error(`Nothing to ${dir}.`)
    to.push(e.project)
    return this.put(id, prev, origin, { recordHistory: false })
  }

  async delete(id: string) {
    await this.get(id)
    this.entries.delete(id)
    for (const [aid, path] of this.assetIndex) if (path.startsWith(this.projectDir(id))) this.assetIndex.delete(aid)
    await rm(this.projectDir(id), { recursive: true, force: true })
    this.emit('deleted', id)
  }

  /** Copies a local file into the project and probes it. Does not modify the document. */
  async storeAsset(id: string, sourcePath: string, displayName?: string): Promise<Asset> {
    await this.get(id)
    const st = await stat(sourcePath).catch(() => null)
    if (!st?.isFile()) throw new NotFoundError(`File not found: ${sourcePath}`)
    if (st.size > 4 * 1024 ** 3) throw new Error('File larger than 4 GB.')
    const ext = extname(sourcePath).toLowerCase()
    if (!MEDIA_TYPES[ext]) throw new Error(`Unsupported file type "${ext}". Supported: ${Object.keys(MEDIA_TYPES).join(' ')}`)
    const info = await probeFile(sourcePath)
    const assetId = `asset-${uid()}`
    const dir = join(this.projectDir(id), 'assets')
    await mkdir(dir, { recursive: true })
    const dest = join(dir, `${assetId}${ext}`)
    await copyFile(sourcePath, dest)
    this.assetIndex.set(assetId, dest)
    return { id: assetId, name: displayName ?? basename(sourcePath), ...info }
  }

  /** Imports a local file and registers it in the project (optionally on a device screen). */
  async importMedia(id: string, sourcePath: string, opts: { deviceId?: string; assign?: boolean; name?: string } = {}, origin = 'agent') {
    let asset = await this.storeAsset(id, sourcePath, opts.name)
    type Extra = { palette?: string[]; regions?: ScreenRegion[]; analysis?: MusicAnalysis }
    const extra: Extra = this.enrich ? await this.enrich(asset.id, asset.kind).catch((err): Extra => {
      console.error('[unicali] media analysis failed:', (err as Error).message)
      return {}
    }) : {}
    if (extra.palette) asset = { ...asset, palette: extra.palette }
    if (extra.regions?.length) asset = { ...asset, regions: extra.regions }
    const { project } = await this.get(id)
    const saved = await this.put(id, addAssetToProject(project, asset, { ...opts, analysis: extra.analysis }), origin)
    return { asset, analysis: extra.analysis ?? null, ...saved }
  }

  assetPath(assetId: string) {
    return this.assetIndex.get(assetId) ?? null
  }

  /** Serialises writes per project and writes atomically (tmp + rename). */
  private persist(project: Project) {
    const prev = this.writeQueue.get(project.id) ?? Promise.resolve()
    const next = prev.then(async () => {
      const dir = this.projectDir(project.id)
      await mkdir(dir, { recursive: true })
      const file = join(dir, 'project.json')
      const tmp = `${file}.${process.pid}.tmp`
      await writeFile(tmp, JSON.stringify(project, null, 2))
      await rename(tmp, file)
    })
    this.writeQueue.set(project.id, next.catch(() => {}))
    return next
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

/** Project ids become folder names: refuse anything that could escape the workspace. */
function safeId(id: string) {
  if (!/^[\w-]{1,64}$/.test(id)) throw new NotFoundError(`Invalid project id "${id}"`)
  return id
}
