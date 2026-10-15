import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TakeSchema, type Step } from '../../src/core/capture/steps'
import { describeTree } from '../../src/core/capture/uitree'
import type { Workspace } from '../workspace'
import { AndroidSource } from './android/source'
import { shootTake } from './take'
import type { CaptureSession, CaptureSource, Look, OpenOptions } from './types'

/**
 * Owns capture sources and live sessions for the server. Everything that produces material
 * ends in Workspace.importMedia, so captured stills and takes become ordinary assets.
 */
export class CaptureHub {
  private sources = new Map<string, CaptureSource>([['android', new AndroidSource()]])
  private sessions = new Map<string, CaptureSession>()
  private readonly workspace: Workspace

  constructor(workspace: Workspace) {
    this.workspace = workspace
  }

  register(source: CaptureSource) {
    this.sources.set(source.kind, source)
  }

  async targets() {
    const all = await Promise.all([...this.sources.values()].map((s) => s.listTargets().catch(() => [])))
    return all.flat()
  }

  async open(kind: string, opts: OpenOptions) {
    const source = this.sources.get(kind)
    if (!source) throw new Error(`Unknown capture source "${kind}". Available: ${[...this.sources.keys()].join(', ')}`)
    const session = await source.open(opts)
    this.sessions.set(session.id, session)
    return session
  }

  get(id: string) {
    const s = this.sessions.get(id)
    if (!s) throw new Error(`No capture session "${id}". Open one with capture_open.`)
    return s
  }

  list() {
    return [...this.sessions.values()].map(info)
  }

  async look(id: string, tree = true) {
    const s = this.get(id)
    return presentLook(s, await s.look({ tree }))
  }

  async act(id: string, step: Step, withLook = true) {
    const s = this.get(id)
    await s.act(step)
    if (!withLook) return { ok: true }
    // Count-ups, transitions and loading states must finish before we judge the screen.
    const waited = await s.waitForStill(3500)
    const look = presentLook(s, await s.look())
    return waited >= 3500 ? { ...look, warning: [look.warning, 'Screen still moving after 3.5 s (loading shimmer or a looping animation?)'].filter(Boolean).join(' · ') } : look
  }

  /** Clean still → project asset (palette and UI regions detected on import). */
  async still(id: string, projectId: string, label: string, assign = false) {
    const s = this.get(id)
    await s.waitForStill(3000)
    const look = await s.look({ tree: false })
    if (look.blank) throw new Error('The screen is black: the app shows a protected window (FLAG_SECURE) or the screen is off. Nothing was saved.')
    const file = join(mkdtempSync(join(tmpdir(), 'unicali-still-')), `${slug(label)}.png`)
    writeFileSync(file, look.png)
    const out = await this.workspace.importMedia(projectId, file, {
      name: `${label}.png`,
      assign,
      extra: { source: { kind: s.kind, target: s.target, app: s.app ?? look.app, label, capturedAt: Date.now() } },
    }, 'capture')
    return { asset: out.asset, revision: out.revision }
  }

  /** Directed take → trimmed video asset with moments and a poster. */
  async take(id: string, projectId: string, raw: unknown) {
    const s = this.get(id)
    const take = TakeSchema.parse(raw)
    const result = await shootTake(s, take)
    const out = await this.workspace.importMedia(projectId, result.videoPath, {
      name: `${take.label}.mp4`,
      assign: false,
      extra: { source: { kind: s.kind, target: s.target, app: s.app ?? undefined, label: take.label, steps: [...take.setup, ...result.performed], capturedAt: Date.now() } },
    }, 'capture')
    return { asset: out.asset, revision: out.revision, performed: result.performed }
  }

  /** Manual recording (the editor's Record button): whatever happens on the device is the take. */
  async recordStart(id: string) {
    await this.get(id).startRecording()
    return { recording: true }
  }

  async recordStop(id: string, projectId: string, label: string) {
    const s = this.get(id)
    const path = await s.stopRecording()
    const out = await this.workspace.importMedia(projectId, path, {
      name: `${label}.mp4`,
      assign: false,
      extra: { source: { kind: s.kind, target: s.target, app: s.app ?? undefined, label, capturedAt: Date.now() } },
    }, 'capture')
    return { asset: out.asset, revision: out.revision }
  }

  async close(id: string) {
    const s = this.get(id)
    this.sessions.delete(id)
    await s.close()
  }

  /** Restores every device (demo mode off, recordings stopped) — called on shutdown. */
  async closeAll() {
    await Promise.all([...this.sessions.keys()].map((id) => this.close(id).catch(() => {})))
  }
}

const info = (s: CaptureSession) => ({ sessionId: s.id, kind: s.kind, target: s.target, app: s.app, size: s.size })

function presentLook(s: CaptureSession, look: Look) {
  return {
    ...info(s),
    foreground: look.app,
    blank: look.blank,
    ...(look.blank ? { warning: 'Black frame: protected window (FLAG_SECURE) or screen off.' } : {}),
    elements: describeTree(look.tree),
    png: look.png.toString('base64'),
  }
}

const slug = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'still'
