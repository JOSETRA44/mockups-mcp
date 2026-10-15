import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Camera, Circle, Loader2, Smartphone, Square, X } from 'lucide-react'
import { backend } from '@/media/backend'
import { useEditor } from '@/state/editor'
import { Button } from '../common/controls'
import { notify } from '../common/toast'

interface Target { id: string; name: string; state: string }
interface Look { sessionId: string; target: string; app: string | null; foreground: string; warning?: string; png: string }

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/capture${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(json?.error?.message ?? res.statusText)
  return json as T
}

/**
 * Capture material from a phone or emulator: live screen (click to tap, wheel to scroll),
 * clean stills and recorded takes. Uses the same server endpoints as the agent tools.
 */
export function CapturePanel() {
  const { t } = useTranslation()
  const [targets, setTargets] = useState<Target[]>([])
  const [target, setTarget] = useState('')
  const [app, setApp] = useState(() => localStorage.getItem('unicali.captureApp') ?? '')
  const [look, setLook] = useState<Look | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [text, setText] = useState('')
  const [label, setLabel] = useState('')
  const imgRef = useRef<HTMLImageElement>(null)
  const remote = backend.kind === 'remote'

  useEffect(() => {
    if (!remote) return
    void api<{ targets: Target[] }>('GET', '/targets').then((r) => {
      setTargets(r.targets)
      setTarget((cur) => cur || r.targets.find((x) => x.state === 'ready')?.id || r.targets[0]?.id || '')
    }).catch(() => {})
    void api<{ sessions: { sessionId: string }[] }>('GET', '/sessions').then(async (r) => {
      if (r.sessions[0]) setLook(await api<Look>('GET', `/sessions/${r.sessions[0].sessionId}/look?tree=0`))
    }).catch(() => {})
  }, [remote])

  const run = async <T,>(label: string, fn: () => Promise<T>) => {
    setBusy(label)
    try {
      return await fn()
    } catch (err) {
      notify((err as Error).message, 'error')
      return null
    } finally {
      setBusy(null)
    }
  }

  if (!remote) {
    return <p className="rounded-lg border border-dashed border-ink-700 p-3 text-[11px] leading-relaxed text-ink-400">{t('capture.needsServer')}</p>
  }

  const projectId = () => useEditor.getState().project.id
  const sid = look?.sessionId

  const open = () => run('open', async () => {
    localStorage.setItem('unicali.captureApp', app)
    setLook(await api<Look>('POST', '/sessions', { kind: 'android', target, app: app || undefined }))
  })
  const act = (step: unknown) => sid && run('act', async () => setLook(await api<Look>('POST', `/sessions/${sid}/act`, { step })))
  const onClick = (e: React.MouseEvent) => {
    const r = imgRef.current!.getBoundingClientRect()
    void act({ tap: { at: [+((e.clientX - r.left) / r.width).toFixed(4), +((e.clientY - r.top) / r.height).toFixed(4)] } })
  }
  const onWheel = (e: React.WheelEvent) => void act({ scroll: e.deltaY > 0 ? 'down' : 'up', amount: 0.35 })
  const snap = () => sid && run('snap', async () => {
    await api('POST', `/sessions/${sid}/still`, { projectId: projectId(), label: label || 'Screen' })
    notify(t('capture.saved'))
  })
  const toggleRecord = () => sid && run('record', async () => {
    if (!recording) {
      await api('POST', `/sessions/${sid}/record-start`, {})
      setRecording(true)
    } else {
      setRecording(false)
      await api('POST', `/sessions/${sid}/record-stop`, { projectId: projectId(), label: label || 'Take' })
      notify(t('capture.saved'))
    }
  })
  const close = () => sid && run('close', async () => {
    await api('DELETE', `/sessions/${sid}`)
    setLook(null)
  })

  if (!look) {
    return (
      <div className="space-y-2 rounded-lg border border-ink-700 p-3">
        <select value={target} onChange={(e) => setTarget(e.target.value)} className="h-8 w-full rounded-md border border-ink-700 bg-ink-800 px-2 text-xs">
          {targets.length === 0 && <option value="">{t('capture.noTargets')}</option>}
          {targets.map((x) => <option key={x.id} value={x.id}>{x.name}{x.state === 'bootable' ? ` · ${t('capture.boot')}` : x.state !== 'ready' ? ` · ${x.state}` : ''}</option>)}
        </select>
        <input value={app} onChange={(e) => setApp(e.target.value)} placeholder="com.example.app" className="h-8 w-full rounded-md bg-ink-800 px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-accent" />
        <Button variant="primary" className="w-full" onClick={open} disabled={!target || !!busy}>
          {busy === 'open' ? <Loader2 size={14} className="animate-spin" /> : <Smartphone size={14} />} {t('capture.open')}
        </Button>
        <p className="text-[10px] leading-snug text-ink-400">{t('capture.cleanHint')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-2 rounded-lg border border-ink-700 p-2">
      <div className="flex items-center justify-between px-1 text-[11px] text-ink-300">
        <span className="truncate">{look.target} · {look.foreground}</span>
        <button onClick={close} title={t('capture.close')} className="text-ink-400 hover:text-white"><X size={13} /></button>
      </div>
      <div className="relative">
        <img
          ref={imgRef}
          src={`data:image/png;base64,${look.png}`}
          alt=""
          onClick={onClick}
          onWheel={onWheel}
          className={clsx('w-full cursor-pointer rounded-md border', recording ? 'border-red-500' : 'border-ink-700', busy && 'opacity-70')}
          draggable={false}
          data-testid="capture-screen"
        />
        {busy && <Loader2 size={18} className="absolute right-2 top-2 animate-spin text-white" />}
        {recording && <span className="absolute left-2 top-2 flex items-center gap-1 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white"><Circle size={8} fill="currentColor" /> REC</span>}
      </div>
      {look.warning && <p className="text-[10px] text-amber-300">{look.warning}</p>}
      <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); if (text) void act({ type: text }); setText('') }}>
        <Button className="h-7 w-7 shrink-0 px-0" onClick={() => void act({ back: true })} title={t('capture.back')}><ArrowLeft size={13} /></Button>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('capture.type')} className="h-7 min-w-0 flex-1 rounded-md bg-ink-800 px-2 text-xs outline-none focus:ring-1 focus:ring-accent" />
      </form>
      <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('capture.labelPrompt')} className="h-7 w-full rounded-md bg-ink-800 px-2 text-xs outline-none focus:ring-1 focus:ring-accent" />
      <div className="grid grid-cols-2 gap-1.5">
        <Button variant="outline" className="h-8 text-xs" onClick={snap} disabled={!!busy || recording}><Camera size={13} /> {t('capture.snap')}</Button>
        <Button variant={recording ? 'danger' : 'outline'} className="h-8 text-xs" onClick={toggleRecord} disabled={!!busy && busy !== 'record'}>
          {recording ? <Square size={12} /> : <Circle size={12} />} {recording ? t('capture.stop') : t('capture.record')}
        </Button>
      </div>
    </div>
  )
}
