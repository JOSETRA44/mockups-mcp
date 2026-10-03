/**
 * Headless render entry (render.html). The Unicali server drives this page in headless
 * Chrome so agents and the CLI get pixels from the exact same Engine/exporter as the editor.
 */
import { evaluate } from '@/core/animation/evaluate'
import { parseProject, type Project } from '@/core/schema/project'
import { Engine } from '@/engine/Engine'
import { AssetSourceProvider } from '@/engine/sources/sources'
import { exportProject, type ExportOptions } from '@/export/exporter'
import { setRemoteAssetBase } from '@/media/assetStore'

setRemoteAssetBase('')

async function loadProject(projectId: string): Promise<Project> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`)
  if (!res.ok) throw new Error(`Cannot load project ${projectId}: ${res.status}`)
  return parseProject((await res.json()).project)
}

export interface FramesOptions {
  times: number[]
  /** Width of each tile in pixels (height follows the project aspect). */
  width: number
  columns?: number
  /** Draw the time label on each tile. */
  labels?: boolean
}

/** Renders the given times into one contact-sheet PNG (data URL). */
async function frames(projectId: string, opts: FramesOptions): Promise<string> {
  const project = await loadProject(projectId)
  const aspect = project.settings.width / project.settings.height
  const w = Math.max(32, Math.round(opts.width / 2) * 2)
  const h = Math.max(32, Math.round(w / aspect / 2) * 2)
  const canvas = new OffscreenCanvas(w, h)
  const engine = new Engine({ canvas, width: w, height: h, preserveDrawingBuffer: true })
  const provider = new AssetSourceProvider('exact')
  provider.setAssets(project.assets)
  engine.setSources(provider)
  const used = project.nodes.flatMap((n) => (n.type === 'device' && n.screen.assetId ? [n.screen.assetId] : []))
  await Promise.all(used.map((id) => provider.load(id)))

  const times = opts.times.length ? opts.times : [0]
  const cols = Math.max(1, Math.min(opts.columns ?? 4, times.length))
  const rows = Math.ceil(times.length / cols)
  const gap = times.length > 1 ? 8 : 0
  const sheet = new OffscreenCanvas(cols * w + (cols - 1) * gap, rows * h + (rows - 1) * gap)
  const ctx = sheet.getContext('2d')!
  ctx.fillStyle = '#111'
  ctx.fillRect(0, 0, sheet.width, sheet.height)
  try {
    for (const [i, t] of times.entries()) {
      const scene = evaluate(project, Math.min(Math.max(0, t), project.settings.duration))
      await engine.prepareSources(scene, false)
      engine.render(scene)
      const x = (i % cols) * (w + gap), y = Math.floor(i / cols) * (h + gap)
      ctx.drawImage(canvas, x, y)
      if (opts.labels !== false && times.length > 1) {
        const label = `${t.toFixed(2)}s`
        ctx.font = `600 ${Math.max(11, Math.round(w / 18))}px system-ui, sans-serif`
        const tw = ctx.measureText(label).width
        ctx.fillStyle = 'rgba(0,0,0,0.65)'
        ctx.fillRect(x + 6, y + 6, tw + 12, Math.max(11, Math.round(w / 18)) + 10)
        ctx.fillStyle = '#fff'
        ctx.fillText(label, x + 12, y + 6 + Math.max(11, Math.round(w / 18)) + 2)
      }
    }
  } finally {
    provider.dispose()
    engine.dispose()
  }
  const blob = await sheet.convertToBlob({ type: 'image/png' })
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.readAsDataURL(blob)
  })
}

/** Exports the project and streams the file back to the server (uploadUrl). */
async function exportTo(projectId: string, opts: Omit<ExportOptions, 'fileHandle'>, uploadUrl: string) {
  const project = await loadProject(projectId)
  const result = await exportProject(project, opts)
  if (!result.blob) throw new Error('Export produced no data')
  const res = await fetch(uploadUrl, { method: 'PUT', body: result.blob })
  if (!res.ok) throw new Error(`Upload failed: ${res.status} ${await res.text()}`)
  return { filename: result.filename, codec: result.codec, frames: result.frames, seconds: result.seconds, bytes: result.blob.size }
}

declare global {
  interface Window {
    unicaliRender: { ready: boolean; frames: typeof frames; export: typeof exportTo }
  }
}

window.unicaliRender = { ready: true, frames, export: exportTo }
