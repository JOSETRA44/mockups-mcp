import clsx from 'clsx'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowRightFromLine, Focus, Hand, Image as ImageIcon, Move3d, Orbit, Plane, RefreshCw,
  Music2, Plus, Rocket, Smartphone, Sparkles, Upload, Video, Waves, ZoomIn, ZoomOut, type LucideIcon,
} from 'lucide-react'
import { DEVICES, getDevice } from '@/core/devices/registry'
import { PRESETS } from '@/core/presets/registry'
import type { Preset } from '@/core/presets/types'
import type { Asset, DeviceNode } from '@/core/schema/project'
import { ACCEPTED } from '@/media/import'
import { importIntoEditor } from '@/media/backend'
import { firstDevice, useEditor } from '@/state/editor'
import { cueProject, usePlayback } from '@/state/playback'
import { TEMPLATES } from '@/core/commands/templates'
import type { ShotKind } from '@/core/schema/project'
import { SHOT_ICONS } from '../common/shotIcons'
import { notify } from '../common/toast'
import { useBlobUrl } from '../common/useBlobUrl'
import { CapturePanel } from './CapturePanel'

type Tab = 'device' | 'media' | 'motion'

export function Sidebar() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('media')
  const tabs: { id: Tab; icon: LucideIcon }[] = [
    { id: 'device', icon: Smartphone },
    { id: 'media', icon: ImageIcon },
    { id: 'motion', icon: Rocket },
  ]
  return (
    <aside className="flex w-[272px] shrink-0 flex-col border-r border-ink-700 bg-ink-900">
      <nav className="flex gap-1 border-b border-ink-700 p-1.5">
        {tabs.map(({ id, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={clsx(
              'flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-xs font-medium',
              tab === id ? 'bg-ink-700 text-white' : 'text-ink-300 hover:bg-ink-800',
            )}
          >
            <Icon size={14} />
            {t(`sidebar.${id}`)}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'device' && <DevicePanel />}
        {tab === 'media' && <MediaPanel />}
        {tab === 'motion' && <MotionPanel />}
      </div>
    </aside>
  )
}

function useActiveDevice(): DeviceNode | undefined {
  return useEditor((s) => {
    const sel = s.selection
    const byId = sel.kind === 'device' ? s.project.nodes.find((n) => n.id === sel.id) : undefined
    return (byId?.type === 'device' ? byId : firstDevice(s.project)) as DeviceNode | undefined
  })
}

function DevicePanel() {
  const { t } = useTranslation()
  const device = useActiveDevice()
  const update = useEditor((s) => s.update)
  if (!device) return null
  const spec = getDevice(device.deviceId)
  const setNode = (fn: (d: DeviceNode) => void) =>
    update((p) => {
      const n = p.nodes.find((x) => x.id === device.id)
      if (n?.type === 'device') fn(n)
    })

  return (
    <div className="space-y-5 p-3">
      <div>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">{t('device.model')}</h3>
        <div className="grid grid-cols-2 gap-2">
          {DEVICES.map((d) => (
            <button
              key={d.id}
              onClick={() => setNode((n) => { n.deviceId = d.id; n.finishId = d.finishes[0].id; n.name = d.name })}
              className={clsx(
                'flex flex-col items-center gap-2 rounded-lg border p-3 transition-colors',
                d.id === device.deviceId ? 'border-accent bg-accent-soft' : 'border-ink-700 hover:border-ink-600 hover:bg-ink-800',
              )}
            >
              <DeviceGlyph spec={d} />
              <span className="text-xs">{d.name}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">{t('device.finish')}</h3>
        <div className="flex flex-wrap gap-2">
          {spec.finishes.map((f) => (
            <button
              key={f.id}
              title={f.name}
              onClick={() => setNode((n) => { n.finishId = f.id })}
              className={clsx('h-8 w-8 rounded-full border-2', f.id === device.finishId ? 'border-accent' : 'border-ink-700')}
              style={{ background: `radial-gradient(circle at 35% 30%, #ffffff55, ${f.color} 55%)` }}
            />
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-400">{spec.finishes.find((f) => f.id === device.finishId)?.name}</p>
      </div>
      <button
        onClick={() => {
          const s = useEditor.getState()
          const count = s.project.nodes.filter((n) => n.type === 'device').length
          const out = s.exec('add_device', { model: device.deviceId, position: [count % 2 ? 1.25 * Math.ceil(count / 2) : -1.25 * Math.ceil(count / 2), 0, -0.3] })
          if (out?.deviceId) s.select({ kind: 'device', id: String(out.deviceId) })
        }}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-ink-600 py-2 text-xs text-ink-300 hover:border-accent hover:text-white"
      >
        <Plus size={13} /> {t('device.add')}
      </button>
    </div>
  )
}

function DeviceGlyph({ spec }: { spec: (typeof DEVICES)[number] }) {
  const h = 54, w = (spec.body.width / spec.body.height) * h
  return (
    <div className="relative rounded-[9px] border-2 border-ink-300 bg-ink-950" style={{ width: w, height: h }}>
      <div
        className={clsx('absolute left-1/2 top-1 -translate-x-1/2 rounded-full bg-ink-300', spec.island === 'dynamic' ? 'h-1 w-3' : 'h-1 w-1')}
      />
    </div>
  )
}

function MediaPanel() {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const assets = useEditor((s) => s.project.assets)
  const device = useActiveDevice()

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    try {
      for (const f of Array.from(files)) await importIntoEditor(f, { deviceId: device?.id })
    } catch (err) {
      notify((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 p-3">
      <button
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); void onFiles(e.dataTransfer.files) }}
        className="flex w-full flex-col items-center gap-1.5 rounded-xl border-2 border-dashed border-ink-600 px-4 py-6 text-center transition-colors hover:border-accent hover:bg-accent-soft"
      >
        <Upload size={22} className="text-accent" />
        <span className="font-medium">{busy ? t('media.importing') : t('media.drop')}</span>
        <span className="text-xs text-ink-400">{t('media.browse')}</span>
        <span className="text-[11px] text-ink-400">{t('media.formats')}</span>
      </button>
      <input ref={inputRef} type="file" accept={ACCEPTED} multiple hidden onChange={(e) => void onFiles(e.target.files)} data-testid="media-input" />

      <div>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">{t('capture.title')}</h3>
        <CapturePanel />
      </div>

      {Object.keys(assets).length > 0 && (
        <div>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">{t('media.library')}</h3>
          <div className="grid grid-cols-2 gap-2">
            {Object.values(assets).map((a) => (
              <MediaTile key={a.id} asset={a} active={device?.screen.assetId === a.id} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function MediaTile({ asset, active }: { asset: Asset; active: boolean }) {
  const { t } = useTranslation()
  const url = useBlobUrl(asset.id)
  const update = useEditor((s) => s.update)
  const device = useActiveDevice()
  return (
    <button
      title={t('media.use')}
      onClick={() => {
        if (asset.kind === 'audio') return useEditor.getState().select({ kind: 'music' })
        if (device) update((p) => {
          const n = p.nodes.find((x) => x.id === device.id)
          if (n?.type === 'device') n.screen.assetId = asset.id
        })
      }}
      className={clsx('group relative overflow-hidden rounded-lg border bg-ink-950', active ? 'border-accent' : 'border-ink-700 hover:border-ink-600')}
    >
      <div className="aspect-[9/16] w-full">
        {asset.kind === 'audio' && <div className="flex h-full items-center justify-center bg-emerald-500/10"><Music2 size={26} className="text-emerald-300" /></div>}
        {url && asset.kind !== 'audio' && (asset.kind === 'image'
          ? <img src={url} alt={asset.name} className="h-full w-full object-cover" draggable={false} />
          : <video src={`${url}#t=0.1`} muted playsInline preload="metadata" className="h-full w-full object-cover" />)}
      </div>
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/90 to-transparent px-2 pb-1.5 pt-4 text-[11px]">
        {asset.kind === 'video' ? <Video size={11} /> : asset.kind === 'audio' ? <Music2 size={11} /> : <ImageIcon size={11} />}
        <span className="truncate">{asset.name}</span>
      </div>
      {active && <span className="absolute right-1.5 top-1.5 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold">{t('media.inUse')}</span>}
    </button>
  )
}

const PRESET_ICONS: Record<string, LucideIcon> = {
  'hero-reveal': Rocket,
  'side-entrance': ArrowRightFromLine,
  'fly-by': Plane,
  'hero-spin': RefreshCw,
  tilt: Move3d,
  floating: Waves,
  'push-in': ZoomIn,
  'pull-out': ZoomOut,
  'camera-orbit': Orbit,
  'screen-focus': Focus,
}

function MotionPanel() {
  const { t } = useTranslation()
  const addPresetClip = useEditor((s) => s.addPresetClip)
  const categories: Preset['category'][] = ['entrance', 'camera', 'emphasis', 'loop']
  return (
    <div className="space-y-4 p-3">
      <div>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">{t('motion.story')}</h3>
        <button
          onClick={() => {
            const out = useEditor.getState().exec('create_storyboard', {})
            if (out?.shotIds) useEditor.getState().select({ kind: 'shot', id: String((out.shotIds as string[])[1] ?? (out.shotIds as string[])[0]) })
          }}
          className="mb-2 flex w-full items-center gap-2 rounded-lg bg-accent/20 px-3 py-2.5 text-left text-xs font-medium text-violet-100 hover:bg-accent/30"
        >
          <Sparkles size={15} /> {t('shots.storyboard')}
        </button>
        <div className="grid grid-cols-5 gap-1">
          {(Object.keys(SHOT_ICONS) as ShotKind[]).map((k) => {
            const Icon = SHOT_ICONS[k]
            return (
              <button
                key={k}
                title={t(`shots.kindHints.${k}`)}
                onClick={() => {
                  const out = useEditor.getState().exec('add_shot', { kind: k, duration: 2, time: usePlayback.getState().time })
                  if (out?.shotId) useEditor.getState().select({ kind: 'shot', id: String(out.shotId) })
                }}
                className="flex flex-col items-center gap-1 rounded-md border border-ink-700 bg-ink-850 py-2 text-[10px] text-ink-300 hover:border-accent hover:text-white"
              >
                <Icon size={15} />
                {t(`shots.kinds.${k}`)}
              </button>
            )
          })}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-400">{t('motion.storyHint')}</p>
      </div>
      <div>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">{t('motion.templates')}</h3>
        <div className="space-y-1.5">
          {TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              onClick={() => {
                if (useEditor.getState().exec('apply_template', { template: tpl.id })) cueProject(useEditor.getState().project)
              }}
              className="flex w-full items-start gap-2.5 rounded-lg border border-ink-700 bg-ink-850 p-2.5 text-left transition-colors hover:border-accent hover:bg-accent-soft"
              data-testid={`template-${tpl.id}`}
            >
              <Sparkles size={15} className="mt-0.5 shrink-0 text-accent" />
              <span>
                <span className="block text-xs font-medium">{tpl.name}</span>
                <span className="block text-[11px] leading-snug text-ink-400">{tpl.description}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs leading-relaxed text-ink-400">{t('motion.hint')}</p>
      {categories.map((cat) => (
        <div key={cat}>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">{t(`motion.categories.${cat}`)}</h3>
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.filter((p) => p.category === cat).map((p) => {
              const Icon = PRESET_ICONS[p.id] ?? Hand
              return (
                <button
                  key={p.id}
                  title={p.description}
                  onClick={() => addPresetClip(p.id, usePlayback.getState().time)}
                  className="group flex flex-col items-start gap-2 rounded-lg border border-ink-700 bg-ink-850 p-2.5 text-left transition-colors hover:border-accent hover:bg-accent-soft"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-ink-700 text-ink-100 transition-transform group-hover:scale-110 group-hover:bg-accent">
                    <Icon size={16} />
                  </span>
                  <span className="text-xs font-medium leading-tight">{p.name}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
