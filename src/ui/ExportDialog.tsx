import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, X } from 'lucide-react'
import {
  exportProject, exportSupport, outputSize, type ExportFormat, type ExportOptions, type ExportQuality,
  type ExportResult,
} from '@/export/exporter'
import { useEditor } from '@/state/editor'
import { usePlayback } from '@/state/playback'
import { Button, Select, Toggle } from './common/controls'

type Phase = { kind: 'idle' } | { kind: 'running'; done: number; total: number } | { kind: 'done'; result: ExportResult; url: string | null } | { kind: 'error'; message: string }

const EXT: Record<ExportFormat, { ext: string; mime: string; desc: string }> = {
  mp4: { ext: '.mp4', mime: 'video/mp4', desc: 'MP4 video' },
  webm: { ext: '.webm', mime: 'video/webm', desc: 'WebM video' },
  png: { ext: '.zip', mime: 'application/zip', desc: 'PNG sequence' },
}

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const project = useEditor((s) => s.project)
  const support = exportSupport()
  const transparent = project.settings.background.kind === 'transparent'
  const hasAudio = Object.values(project.assets).some((a) => a.hasAudio)
  const [opts, setOpts] = useState<Omit<ExportOptions, 'fileHandle'>>({
    format: transparent ? 'webm' : 'mp4',
    scale: 1,
    fps: project.settings.fps,
    quality: 'high',
    motionBlur: 1,
    includeAudio: true,
  })
  const [toDisk, setToDisk] = useState(false)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const abortRef = useRef<AbortController | null>(null)
  const size = outputSize(project, opts.scale)

  // Cancel a running export if the dialog unmounts.
  useEffect(() => () => abortRef.current?.abort(), [])
  const doneUrl = phase.kind === 'done' ? phase.url : null
  useEffect(() => () => { if (doneUrl) URL.revokeObjectURL(doneUrl) }, [doneUrl])

  const run = async () => {
    usePlayback.getState().pause()
    let fileHandle: FileSystemFileHandle | undefined
    if (toDisk && support.saveToDisk) {
      try {
        const e = EXT[opts.format]
        fileHandle = await (window as any).showSaveFilePicker({
          suggestedName: `${project.name || 'mockup'}${e.ext}`,
          types: [{ description: e.desc, accept: { [e.mime]: [e.ext] } }],
        })
      } catch {
        return // user dismissed the picker
      }
    }
    const ac = new AbortController()
    abortRef.current = ac
    setPhase({ kind: 'running', done: 0, total: 1 })
    try {
      const result = await exportProject(
        project,
        { ...opts, fileHandle: opts.format === 'png' ? undefined : fileHandle },
        { signal: ac.signal, onProgress: (done, total) => setPhase({ kind: 'running', done, total }) },
      )
      const url = result.blob ? URL.createObjectURL(result.blob) : null
      setPhase({ kind: 'done', result, url })
      if (url) triggerDownload(url, result.filename)
    } catch (err) {
      if ((err as Error).name === 'AbortError') setPhase({ kind: 'idle' })
      else {
        console.error(err)
        setPhase({ kind: 'error', message: (err as Error).message })
      }
    } finally {
      abortRef.current = null
    }
  }

  const running = phase.kind === 'running'

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="w-[440px] rounded-xl border border-ink-700 bg-ink-900 shadow-2xl">
        <header className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
          <h2 className="text-sm font-semibold">{t('export.title')}</h2>
          <button className="text-ink-400 hover:text-white" onClick={onClose} disabled={running}><X size={16} /></button>
        </header>

        <div className="space-y-3 p-4">
          {!support.webcodecs && opts.format !== 'png' && (
            <p className="rounded-md bg-danger/10 p-2 text-xs text-[#ffb3c1]">{t('export.unsupported')}</p>
          )}
          <Select
            label={t('export.format')}
            value={opts.format}
            options={(['mp4', 'webm', 'png'] as ExportFormat[]).map((f) => ({ value: f, label: t(`export.${f}`) }))}
            onChange={(format) => setOpts({ ...opts, format })}
          />
          <Select
            label={t('export.resolution')}
            value={String(opts.scale)}
            options={[0.5, 1, 1.5, 2].map((s) => {
              const o = outputSize(project, s)
              return { value: String(s), label: `${s === 1 ? 'Full' : `${s}×`} — ${o.width}×${o.height}` }
            })}
            onChange={(v) => setOpts({ ...opts, scale: Number(v) })}
          />
          <Select
            label={t('export.fps')}
            value={String(opts.fps)}
            options={['24', '30', '60'].map((v) => ({ value: v, label: `${v} fps` }))}
            onChange={(v) => setOpts({ ...opts, fps: Number(v) })}
          />
          {opts.format !== 'png' && (
            <Select
              label={t('export.quality')}
              value={opts.quality}
              options={(['standard', 'high', 'max'] as ExportQuality[]).map((q) => ({ value: q, label: t(`export.${q}`) }))}
              onChange={(quality) => setOpts({ ...opts, quality })}
            />
          )}
          <Select
            label={t('export.motionBlur')}
            value={String(opts.motionBlur)}
            options={[1, 4, 8].map((n) => ({ value: String(n), label: n === 1 ? t('export.off') : `${n} samples` }))}
            onChange={(v) => setOpts({ ...opts, motionBlur: Number(v) })}
          />
          {hasAudio && opts.format !== 'png' && (
            <Toggle label={t('export.audio')} value={opts.includeAudio} onChange={(includeAudio) => setOpts({ ...opts, includeAudio })} />
          )}
          {support.saveToDisk && opts.format !== 'png' && (
            <Toggle label={t('export.saveToDisk')} value={toDisk} onChange={setToDisk} />
          )}
          {transparent && <p className="text-[11px] text-ink-400">{t('export.transparentHint')}</p>}
          <p className="text-[11px] tabular-nums text-ink-400">
            {size.width}×{size.height} · {opts.fps} fps · {Math.round(project.settings.duration * opts.fps)} frames
          </p>

          {phase.kind === 'running' && (
            <div className="space-y-1.5" data-testid="export-progress">
              <div className="h-1.5 overflow-hidden rounded-full bg-ink-700">
                <div className="h-full bg-accent transition-[width]" style={{ width: `${(phase.done / phase.total) * 100}%` }} />
              </div>
              <p className="text-xs text-ink-300">{t('export.rendering', { done: phase.done, total: phase.total })}</p>
            </div>
          )}
          {phase.kind === 'done' && (
            <div className="rounded-md bg-emerald-500/10 p-2 text-xs text-emerald-200" data-testid="export-done">
              {t('export.done', { seconds: phase.result.seconds.toFixed(1), frames: phase.result.frames, codec: phase.result.codec })}
            </div>
          )}
          {phase.kind === 'error' && (
            <p className="rounded-md bg-danger/10 p-2 text-xs text-[#ffb3c1]">{t('export.failed', { message: phase.message })}</p>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-ink-700 px-4 py-3">
          {running ? (
            <Button variant="outline" onClick={() => abortRef.current?.abort()}>{t('export.cancel')}</Button>
          ) : (
            <Button variant="ghost" onClick={onClose}>{t('export.close')}</Button>
          )}
          {phase.kind === 'done' && phase.url && (
            <Button variant="outline" onClick={() => triggerDownload(phase.url!, phase.result.filename)}>
              <Download size={14} /> {t('export.download')}
            </Button>
          )}
          <Button variant="primary" onClick={run} disabled={running || (!support.webcodecs && opts.format !== 'png')} className="min-w-24">
            {t('export.start')}
          </Button>
        </footer>
      </div>
    </div>
  )
}

function triggerDownload(url: string, filename: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
}
