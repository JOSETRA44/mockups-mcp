/**
 * Headless render entry (render.html). The Unicali server drives this page in headless
 * Chrome so agents and the CLI get pixels from the exact same Engine/exporter as the editor.
 */
import { evaluate } from '@/core/animation/evaluate'
import { screenAssetIds } from '@/core/shots/media'
import { parseProject, type Project } from '@/core/schema/project'
import { Engine } from '@/engine/Engine'
import { AssetSourceProvider } from '@/engine/sources/sources'
import { exportProject, type ExportOptions } from '@/export/exporter'
import { getBlob, setRemoteAssetBase } from '@/media/assetStore'
import { analyzeBlob, visualOf } from '@/media/audio'
import { analyzeVideo, drawAssetFrame } from '@/media/takes'

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
  const used = screenAssetIds(project)
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

/** Media intelligence for server-side imports: same code as the editor uses. */
async function analyze(assetId: string, kind: 'image' | 'video' | 'audio') {
  const blob = await getBlob(assetId)
  if (!blob) throw new Error(`Asset ${assetId} not found`)
  if (kind === 'audio') return { analysis: (await analyzeBlob(blob)).analysis }
  if (kind === 'video') {
    const take = await analyzeVideo(blob)
    if (take) return take
  }
  return visualOf(blob, kind)
}

export interface SheetItem {
  assetId: string
  label: string
  /** Seconds to show (videos); one tile per time. Images use a single tile. */
  times?: number[]
}

/**
 * Review sheet: rows of material (stills and frames of takes) with labels, so an agent or a
 * human can compare and choose. One row per item.
 */
async function sheet(projectId: string, items: SheetItem[], tileWidth = 150): Promise<string> {
  const project = await loadProject(projectId)
  const rows = items.filter((i) => project.assets[i.assetId])
  const tw = tileWidth
  const aspectOf = (id: string) => {
    const a = project.assets[id]
    return a.width && a.height ? a.width / a.height : 9 / 19.5
  }
  const th = Math.round(tw / Math.min(...rows.map((r) => aspectOf(r.assetId)), 9 / 16))
  const cols = Math.max(1, ...rows.map((r) => (project.assets[r.assetId].kind === 'video' ? r.times?.length ?? 1 : 1)))
  const pad = 10, labelH = 22
  const canvas = new OffscreenCanvas(pad + cols * (tw + pad), pad + rows.length * (th + labelH + pad))
  const g = canvas.getContext('2d')!
  g.fillStyle = '#16171f'
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.font = '600 13px system-ui, sans-serif'
  for (const [r, item] of rows.entries()) {
    const asset = project.assets[item.assetId]
    const blob = await getBlob(item.assetId)
    const y = pad + r * (th + labelH + pad)
    g.fillStyle = '#e8e9f0'
    g.fillText(`${r + 1}. ${item.label}`.slice(0, 80), pad, y + 15)
    if (!blob) continue
    const times = asset.kind === 'video' ? item.times?.length ? item.times : [asset.poster ?? 0] : [0]
    for (const [c, t] of times.entries()) {
      const x = pad + c * (tw + pad)
      await drawAssetFrame(g, blob, asset.kind === 'video' ? 'video' : 'image', t, x, y + labelH, tw, th)
      if (asset.kind === 'video') {
        g.fillStyle = 'rgba(0,0,0,0.65)'
        g.fillRect(x + 4, y + labelH + 4, 46, 18)
        g.fillStyle = '#fff'
        g.font = '600 11px system-ui, sans-serif'
        g.fillText(`${t.toFixed(1)}s`, x + 9, y + labelH + 17)
        g.font = '600 13px system-ui, sans-serif'
      }
    }
  }
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.readAsDataURL(blob)
  })
}

declare global {
  interface Window {
    unicaliRender: { ready: boolean; frames: typeof frames; export: typeof exportTo; analyze: typeof analyze; sheet: typeof sheet }
  }
}

window.unicaliRender = { ready: true, frames, export: exportTo, analyze, sheet }
