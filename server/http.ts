import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, rm, stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, extname, isAbsolute, join, normalize, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { WebSocketServer, type WebSocket } from 'ws'
import { ZodError } from 'zod'
import {
  catalog, commandSchemas, CommandError, describeProject, runBatch, runCommand, sampleScene,
} from '../src/core/commands'
import { uid } from '../src/core/factory'
import { shotHoldTimes } from '../src/core/shots/shots'
import { APP_ROOT, baseUrl, VERSION, type ServerConfig } from './config'
import { MEDIA_TYPES } from './probe'
import { Renderer, type ExportRequest } from './renderer'
import { NotFoundError, Workspace } from './workspace'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
  ...Object.fromEntries(Object.entries(MEDIA_TYPES).map(([k, v]) => [k, v.mime])),
}

class HttpError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage, limit = 64 * 1024 * 1024): Promise<any> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > limit) throw new HttpError(413, 'TOO_LARGE', 'Request body too large')
    chunks.push(c)
  }
  if (!size) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'BAD_JSON', 'Body is not valid JSON')
  }
}

function toHttpError(err: unknown): HttpError {
  if (err instanceof HttpError) return err
  if (err instanceof CommandError) {
    const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'CONFLICT' ? 409 : 400
    return new HttpError(status, err.code, err.message)
  }
  if (err instanceof NotFoundError) return new HttpError(404, 'NOT_FOUND', err.message)
  if (err instanceof ZodError) return new HttpError(400, 'INVALID_ARGS', err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  return new HttpError(500, 'INTERNAL', (err as Error)?.message ?? String(err))
}

const EXPORT_DEFAULTS: ExportRequest = { format: 'mp4', scale: 1, fps: 30, quality: 'high', motionBlur: 1, includeAudio: true }

/** Ensures an output path is absolute, has the right extension and does not clobber files unless asked. */
async function checkOutput(path: string, ext: string, overwrite: boolean) {
  if (!isAbsolute(path)) throw new HttpError(400, 'INVALID_ARGS', `outputPath must be absolute: ${path}`)
  const p = normalize(path)
  if (extname(p).toLowerCase() !== ext) throw new HttpError(400, 'INVALID_ARGS', `outputPath must end with ${ext}`)
  if (!overwrite && existsSync(p)) throw new HttpError(409, 'CONFLICT', `File exists: ${p} (pass overwrite=true)`)
  await mkdir(dirname(p), { recursive: true })
  return p
}

export interface UnicaliServer {
  url: string
  workspace: Workspace
  close(): Promise<void>
}

export async function startServer(config: ServerConfig): Promise<UnicaliServer> {
  const workspace = new Workspace(config.home)
  await workspace.init()
  const url = baseUrl(config)
  const renderer = new Renderer(url)
  workspace.enrich = (assetId, kind) => renderer.analyze(assetId, kind)
  const uploads = new Map<string, { path: string; done: (err?: Error) => void }>()

  const http = createServer((req, res) => {
    handle(req, res).catch((err) => {
      const e = toHttpError(err)
      if (e.status >= 500) console.error('[unicali]', err)
      if (!res.headersSent) send(res, e.status, { error: { code: e.code, message: e.message } })
      else res.end()
    })
  })

  // Editor assets: Vite middleware in dev (HMR, always fresh), the built dist/ otherwise.
  const dist = join(APP_ROOT, 'dist')
  let vite: import('vite').ViteDevServer | null = null
  if (config.dev || !existsSync(join(dist, 'index.html'))) {
    const { createServer: createVite } = await import('vite')
    vite = await createVite({
      root: APP_ROOT,
      configFile: join(APP_ROOT, 'vite.config.ts'),
      server: { middlewareMode: true, ws: { server: http }, forwardConsole: false },
      appType: 'mpa',
      logLevel: 'warn',
    })
  }

  async function serveStatic(req: IncomingMessage, res: ServerResponse) {
    if (vite) {
      vite.middlewares(req, res, () => send(res, 404, { error: { code: 'NOT_FOUND', message: 'Not found' } }))
      return
    }
    const pathname = decodeURIComponent(new URL(req.url!, url).pathname)
    let file = resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`)
    if (!file.startsWith(dist) || !existsSync(file) || (await stat(file)).isDirectory()) file = join(dist, 'index.html')
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
    createReadStream(file).pipe(res)
  }

  /** Streams an asset with HTTP Range support (needed by <video> seeking). */
  async function serveAsset(req: IncomingMessage, res: ServerResponse, assetId: string) {
    const file = workspace.assetPath(assetId)
    if (!file || !existsSync(file)) throw new HttpError(404, 'NOT_FOUND', `No asset ${assetId}`)
    const { size } = await stat(file)
    const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
    const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range)
    if (range) {
      const start = range[1] ? Number(range[1]) : 0
      const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
      res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 })
      createReadStream(file, { start, end }).pipe(res)
    } else {
      res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes' })
      createReadStream(file).pipe(res)
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const u = new URL(req.url!, url)
    const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    if (parts[0] !== 'api') return serveStatic(req, res)
    const m = req.method ?? 'GET'
    const [, a, id, b] = parts

    if (a === 'health') return send(res, 200, { ok: true, name: 'unicali', version: VERSION, home: workspace.home, url })
    if (a === 'catalog') return send(res, 200, { ...catalog(), commands: commandSchemas() })
    if (a === 'assets' && id && m === 'GET') return serveAsset(req, res, id)

    if (a === 'render-jobs' && id && m === 'PUT') {
      const job = uploads.get(id)
      if (!job) throw new HttpError(404, 'NOT_FOUND', 'Unknown render job')
      uploads.delete(id)
      try {
        await pipeline(req, createWriteStream(job.path))
        job.done()
        return send(res, 200, { ok: true })
      } catch (err) {
        job.done(err as Error)
        throw err
      }
    }

    if (a !== 'projects') throw new HttpError(404, 'NOT_FOUND', `No route ${m} ${u.pathname}`)

    if (!id) {
      if (m === 'GET') return send(res, 200, { projects: await workspace.list() })
      if (m === 'POST') {
        const body = await readJson(req)
        return send(res, 201, await workspace.create(body.name, body.template))
      }
    }
    if (id && !b) {
      if (m === 'GET') return send(res, 200, await workspace.get(id))
      if (m === 'PUT') {
        const body = await readJson(req)
        return send(res, 200, await workspace.put(id, body.project, String(body.origin ?? 'client')))
      }
      if (m === 'DELETE') {
        await workspace.delete(id)
        return send(res, 200, { ok: true })
      }
    }
    if (id && m === 'GET' && b === 'describe') {
      const { project, revision } = await workspace.get(id)
      return send(res, 200, { revision, ...describeProject(project) })
    }
    if (id && m === 'POST') {
      const body = await readJson(req, b === 'assets' ? 1024 : undefined)
      const origin = String(body.origin ?? 'agent')
      switch (b) {
        case 'commands': {
          const out = await workspace.exec(
            id,
            (p, ctx) => {
              if (!Array.isArray(body.batch)) return runCommand(p, String(body.command), body.args, ctx)
              const out = runBatch(p, body.batch, ctx)
              return { project: out.project, result: { results: out.results } }
            },
            origin,
          )
          const r = out.result as { results?: unknown } | undefined
          return send(res, 200, { revision: out.revision, result: r, summary: describeProject(out.project) })
        }
        case 'undo':
        case 'redo': {
          const out = b === 'undo' ? await workspace.undo(id, origin) : await workspace.redo(id, origin)
          return send(res, 200, { revision: out.revision, summary: describeProject(out.project) })
        }
        case 'sample': {
          const { project } = await workspace.get(id)
          const times: number[] = Array.isArray(body.times) ? body.times.map(Number) : [0]
          return send(res, 200, { samples: sampleScene(project, times.slice(0, 200)) })
        }
        case 'import': {
          // Import a file from the local disk (server and caller share the machine).
          if (typeof body.path !== 'string') throw new HttpError(400, 'INVALID_ARGS', 'path (absolute local file path) is required')
          const out = await workspace.importMedia(id, resolve(body.path), { deviceId: body.deviceId, assign: body.assign, name: body.name }, origin)
          return send(res, 200, { asset: out.asset, analysis: out.analysis, revision: out.revision })
        }
        case 'frames': {
          const { project } = await workspace.get(id)
          const times: number[] = Array.isArray(body.times) && body.times.length
            ? body.times.map(Number)
            : project.shots.length ? shotHoldTimes(project.shots).slice(0, 24) : [project.settings.duration / 2]
          if (times.length > 24) throw new HttpError(400, 'INVALID_ARGS', 'At most 24 times per contact sheet')
          const png = await renderer.frames(id, {
            times,
            width: Math.min(1920, Math.max(64, Number(body.width ?? (times.length > 1 ? 360 : 720)))),
            columns: body.columns,
            labels: body.labels,
          })
          if (body.outputPath) {
            const out = await checkOutput(String(body.outputPath), '.png', !!body.overwrite)
            await pipeline(async function* () { yield png }, createWriteStream(out))
          }
          res.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length })
          return res.end(png)
        }
        case 'export': {
          const { project } = await workspace.get(id)
          const opts: ExportRequest = { ...EXPORT_DEFAULTS, ...pick(body, Object.keys(EXPORT_DEFAULTS)) }
          const ext = opts.format === 'png' ? '.zip' : `.${opts.format}`
          const name = `${(project.name || 'mockup').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'mockup'}-${stamp()}${ext}`
          const target = await checkOutput(body.outputPath ? String(body.outputPath) : join(workspace.rendersDir(id), name), ext, !!body.overwrite)
          const token = uid()
          const uploaded = new Promise<void>((done, fail) => uploads.set(token, { path: target, done: (e) => (e ? fail(e) : done()) }))
          try {
            const meta = await renderer.export(id, opts, `${url}/api/render-jobs/${token}`)
            await uploaded
            return send(res, 200, { path: target, ...meta, format: opts.format })
          } catch (err) {
            uploads.delete(token)
            await rm(target, { force: true })
            throw err
          }
        }
      }
    }
    if (id && b === 'assets' && m === 'PUT') {
      // Raw upload from the editor: stores + probes the file; the editor registers it itself.
      const name = String(u.searchParams.get('name') ?? 'upload')
      const ext = extname(name).toLowerCase()
      if (!MEDIA_TYPES[ext]) throw new HttpError(400, 'INVALID_ARGS', `Unsupported file type "${ext}"`)
      const tmp = join(tmpdir(), `unicali-${uid()}${ext}`)
      try {
        await pipeline(req, createWriteStream(tmp))
        const register = u.searchParams.get('register') === '1'
        if (register) {
          const out = await workspace.importMedia(id, tmp, { name, assign: u.searchParams.get('assign') !== '0' }, String(u.searchParams.get('origin') ?? 'client'))
          return send(res, 200, { asset: out.asset, revision: out.revision })
        }
        return send(res, 200, { asset: await workspace.storeAsset(id, tmp, name) })
      } finally {
        await rm(tmp, { force: true })
      }
    }
    throw new HttpError(404, 'NOT_FOUND', `No route ${m} ${u.pathname}`)
  }

  // ---- Live sync -------------------------------------------------------------------
  const wss = new WebSocketServer({ noServer: true })
  const subscribers = new Map<WebSocket, { projectId: string; clientId: string }>()
  http.on('upgrade', (req, socket, head) => {
    const u = new URL(req.url!, url)
    if (u.pathname !== '/api/live') return // let Vite HMR handle its own upgrades
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  })
  wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
    const u = new URL(req.url!, url)
    const projectId = u.searchParams.get('project') ?? ''
    const clientId = u.searchParams.get('client') ?? uid()
    try {
      const { project, revision } = await workspace.get(projectId)
      subscribers.set(ws, { projectId, clientId })
      ws.send(JSON.stringify({ type: 'snapshot', project, revision, origin: 'server' }))
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: (err as Error).message }))
      return ws.close()
    }
    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(String(raw))
        if (msg.type === 'put') {
          const out = await workspace.put(projectId, msg.project, clientId)
          ws.send(JSON.stringify({ type: 'ack', revision: out.revision }))
        }
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', message: (err as Error).message }))
      }
    })
    ws.on('close', () => subscribers.delete(ws))
  })
  workspace.on('change', (c) => {
    const payload = JSON.stringify({ type: 'snapshot', project: c.project, revision: c.revision, origin: c.origin })
    for (const [ws, sub] of subscribers) {
      if (sub.projectId === c.projectId && sub.clientId !== c.origin && ws.readyState === ws.OPEN) ws.send(payload)
    }
  })

  await new Promise<void>((ok, fail) => {
    http.once('error', fail)
    http.listen(config.port, config.host, () => ok())
  })

  return {
    url,
    workspace,
    async close() {
      for (const ws of subscribers.keys()) ws.terminate()
      wss.close()
      await renderer.close()
      await vite?.close()
      await new Promise<void>((ok) => http.close(() => ok()))
    },
  }
}

const pick = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]))
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
