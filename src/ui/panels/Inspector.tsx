import clsx from 'clsx'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Crosshair, KeyRound, Trash2 } from 'lucide-react'
import { FORMATS, heroDistance } from '@/core/factory'
import { getPreset } from '@/core/presets/registry'
import type { ParamSpec } from '@/core/presets/types'
import type { CameraNode, Clip, DeviceNode, Lighting, Project, ScreenFit } from '@/core/schema/project'
import { firstDevice, useEditor, type Selection } from '@/state/editor'
import { Button, ColorInput, Section, Segmented, Select, Slider, Toggle } from '../common/controls'
import { useBlobUrl } from '../common/useBlobUrl'

export function Inspector() {
  const { t } = useTranslation()
  const selection = useEditor((s) => s.selection)
  const select = useEditor((s) => s.select)
  const devId = useEditor((s) => firstDevice(s.project)?.id)
  const tabs: { label: string; sel: Selection; active: boolean }[] = [
    { label: t('inspector.scene'), sel: { kind: 'scene' }, active: selection.kind === 'scene' },
    { label: t('sidebar.device'), sel: { kind: 'device', id: devId ?? '' }, active: selection.kind === 'device' },
    { label: t('inspector.camera'), sel: { kind: 'camera' }, active: selection.kind === 'camera' },
  ]
  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-l border-ink-700 bg-ink-900">
      <nav className="flex gap-1 border-b border-ink-700 p-1.5">
        {tabs.map((tab) => (
          <button
            key={tab.label}
            onClick={() => select(tab.sel)}
            className={clsx('h-8 flex-1 rounded-md text-xs font-medium', tab.active ? 'bg-ink-700 text-white' : 'text-ink-300 hover:bg-ink-800')}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {selection.kind === 'scene' && <SceneInspector />}
        {selection.kind === 'device' && <DeviceInspector id={selection.id} />}
        {selection.kind === 'camera' && <CameraInspector />}
        {selection.kind === 'clip' && <ClipInspector id={selection.id} />}
      </div>
    </aside>
  )
}

function SceneInspector() {
  const { t } = useTranslation()
  const settings = useEditor((s) => s.project.settings)
  const update = useEditor((s) => s.update)
  const format = FORMATS.find((f) => f.width === settings.width && f.height === settings.height)?.id ?? 'custom'
  const bg = settings.background
  const setBg = (fn: (b: Project['settings']['background']) => void) => update((p) => fn(p.settings.background))
  const setLight = (fn: (l: Lighting) => void) => update((p) => fn(p.settings.lighting))

  return (
    <>
      <Section title={t('inspector.format')}>
        <Select
          label={t('inspector.format')}
          value={format}
          options={[...FORMATS.map((f) => ({ value: f.id, label: `${f.label}` })), ...(format === 'custom' ? [{ value: 'custom', label: 'Custom' }] : [])]}
          onChange={(id) => {
            const f = FORMATS.find((x) => x.id === id)
            if (!f) return
            update((p) => {
              p.settings.width = f.width
              p.settings.height = f.height
              // Keep the device comfortably framed when the aspect ratio changes.
              const cam = p.nodes.find((n): n is CameraNode => n.type === 'camera')
              const dev = firstDevice(p)
              if (cam && dev) cam.distance = heroDistance(dev.deviceId, f.width / f.height, cam.fov)
            })
          }}
        />
        <p className="text-right text-[11px] tabular-nums text-ink-400">{settings.width} × {settings.height}</p>
        <Slider label={t('inspector.duration')} value={settings.duration} min={1} max={60} step={0.1} unit="s" onChange={(v) => update((p) => { p.settings.duration = v })} />
        <Select
          label={t('inspector.fps')}
          value={String(settings.fps)}
          options={['24', '30', '60'].map((v) => ({ value: v, label: `${v} fps` }))}
          onChange={(v) => update((p) => { p.settings.fps = Number(v) })}
        />
      </Section>

      <Section title={t('inspector.background')}>
        <Segmented
          value={bg.kind}
          options={(['gradient', 'solid', 'transparent'] as const).map((k) => ({ value: k, label: t(`inspector.${k}`) }))}
          onChange={(k) => setBg((b) => { b.kind = k })}
        />
        {bg.kind !== 'transparent' && <ColorInput label={t('inspector.color')} value={bg.color} onChange={(v) => setBg((b) => { b.color = v })} />}
        {bg.kind === 'gradient' && (
          <>
            <ColorInput label={t('inspector.color2')} value={bg.color2} onChange={(v) => setBg((b) => { b.color2 = v })} />
            <Slider label={t('inspector.angle')} value={bg.angle} min={0} max={360} step={1} unit="°" onChange={(v) => setBg((b) => { b.angle = v })} />
          </>
        )}
      </Section>

      <Section title={t('inspector.lighting')}>
        <Segmented
          value={settings.lighting.preset}
          options={(['studio', 'soft', 'dramatic'] as const).map((k) => ({ value: k, label: t(`inspector.${k}`) }))}
          onChange={(k) => setLight((l) => { l.preset = k })}
        />
        <Slider label={t('inspector.intensity')} value={settings.lighting.intensity} min={0} max={3} onChange={(v) => setLight((l) => { l.intensity = v })} />
        <Slider label={t('inspector.environment')} value={settings.lighting.environment} min={0} max={3} onChange={(v) => setLight((l) => { l.environment = v })} />
      </Section>
    </>
  )
}

function DeviceInspector({ id }: { id: string }) {
  const { t } = useTranslation()
  const node = useEditor((s) => s.project.nodes.find((n) => n.id === id)) as DeviceNode | undefined
  const allTracks = useEditor((s) => s.project.tracks)
  const tracks = allTracks.filter((tr) => tr.path.startsWith(`${id}.`))
  const assetName = useEditor((s) => (node?.screen.assetId ? s.project.assets[node.screen.assetId]?.name : null))
  const update = useEditor((s) => s.update)
  if (!node) return null
  const set = (fn: (d: DeviceNode) => void) =>
    update((p) => {
      const n = p.nodes.find((x) => x.id === id)
      if (n?.type === 'device') fn(n)
    })
  const tr = node.transform
  const axes = ['X', 'Y', 'Z'] as const

  return (
    <>
      <Section
        title={t('inspector.transform')}
        actions={<Button className="h-6 px-2 text-xs" onClick={() => set((d) => { d.transform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } })}>{t('inspector.reset')}</Button>}
      >
        {axes.map((a, i) => (
          <Slider key={`p${a}`} label={`${t('inspector.position')} ${a}`} value={tr.position[i]} min={-4} max={4} onChange={(v) => set((d) => { d.transform.position[i] = v })} />
        ))}
        {axes.map((a, i) => (
          <Slider key={`r${a}`} label={`${t('inspector.rotation')} ${a}`} value={tr.rotation[i]} min={-180} max={180} step={1} unit="°" onChange={(v) => set((d) => { d.transform.rotation[i] = v })} />
        ))}
        <Slider label={t('inspector.scale')} value={tr.scale} min={0.2} max={3} onChange={(v) => set((d) => { d.transform.scale = v })} />
      </Section>

      <Section title={t('inspector.screen')}>
        <p className="truncate text-xs text-ink-400">{assetName ?? t('inspector.noMedia')}</p>
        <Segmented
          value={node.screen.fit}
          options={(['cover', 'contain', 'fill'] as ScreenFit[]).map((f) => ({ value: f, label: t(`inspector.${f}`) }))}
          onChange={(f) => set((d) => { d.screen.fit = f })}
        />
        <Slider label={t('inspector.zoom')} value={node.screen.zoom} min={1} max={4} onChange={(v) => set((d) => { d.screen.zoom = v })} />
        <Slider label={t('inspector.panX')} value={node.screen.panX} min={-0.5} max={0.5} onChange={(v) => set((d) => { d.screen.panX = v })} />
        <Slider label={t('inspector.panY')} value={node.screen.panY} min={-0.5} max={0.5} onChange={(v) => set((d) => { d.screen.panY = v })} />
      </Section>

      {tracks.length > 0 && (
        <Section
          title={t('inspector.tracks')}
          actions={
            <Button variant="danger" className="h-6 px-2 text-xs" onClick={() => update((p) => { p.tracks = p.tracks.filter((x) => !x.path.startsWith(`${id}.`)) })}>
              {t('inspector.clearTracks')}
            </Button>
          }
        >
          {tracks.map((x) => (
            <div key={x.id} className="flex justify-between text-xs">
              <span className="font-mono text-ink-300">{x.path.slice(id.length + 1)}</span>
              <span className="text-ink-400">{x.keyframes.length} keys</span>
            </div>
          ))}
        </Section>
      )}
    </>
  )
}

function CameraInspector() {
  const { t } = useTranslation()
  const cam = useEditor((s) => s.project.nodes.find((n) => n.type === 'camera')) as CameraNode | undefined
  const settings = useEditor((s) => s.project.settings)
  const devId = useEditor((s) => firstDevice(s.project)?.deviceId)
  const update = useEditor((s) => s.update)
  if (!cam) return null
  const set = (fn: (c: CameraNode) => void) =>
    update((p) => {
      const n = p.nodes.find((x) => x.type === 'camera')
      if (n?.type === 'camera') fn(n)
    })
  return (
    <Section
      title={t('inspector.camera')}
      actions={
        <Button className="h-6 px-2 text-xs" onClick={() => set((c) => {
          c.target = [0, 0, 0]; c.yaw = 0; c.pitch = 0; c.fov = 30
          c.distance = heroDistance(devId ?? 'phone-pro', settings.width / settings.height, 30)
        })}>
          <Crosshair size={12} /> {t('inspector.frameDevice')}
        </Button>
      }
    >
      <Slider label={t('inspector.yaw')} value={cam.yaw} min={-180} max={180} step={1} unit="°" onChange={(v) => set((c) => { c.yaw = v })} />
      <Slider label={t('inspector.pitch')} value={cam.pitch} min={-80} max={80} step={1} unit="°" onChange={(v) => set((c) => { c.pitch = v })} />
      <Slider label={t('inspector.distance')} value={cam.distance} min={1} max={30} step={0.05} onChange={(v) => set((c) => { c.distance = v })} />
      <Slider label={t('inspector.fov')} value={cam.fov} min={10} max={80} step={1} unit="°" onChange={(v) => set((c) => { c.fov = v })} />
      {(['X', 'Y', 'Z'] as const).map((a, i) => (
        <Slider key={a} label={`${t('inspector.target')} ${a}`} value={cam.target[i]} min={-3} max={3} onChange={(v) => set((c) => { c.target[i] = v })} />
      ))}
    </Section>
  )
}

function ClipInspector({ id }: { id: string }) {
  const { t } = useTranslation()
  const clip = useEditor((s) => s.project.clips.find((c) => c.id === id))
  const { updateClip, removeClip, bake } = useEditor.getState()
  if (!clip) return null
  const preset = getPreset(clip.presetId)
  if (!preset) return null
  return (
    <>
      <Section title={preset.name}>
        <p className="text-xs leading-relaxed text-ink-400">{preset.description}</p>
        <Slider label={t('inspector.start')} value={clip.start} min={0} max={30} step={0.05} unit="s" onChange={(v) => updateClip(id, (c) => { c.start = v })} />
        <Slider label={t('inspector.length')} value={clip.duration} min={0.2} max={20} step={0.05} unit="s" onChange={(v) => updateClip(id, (c) => { c.duration = v })} />
      </Section>
      <Section title={t('inspector.clip')}>
        {clip.presetId === 'screen-focus' && <FocusPicker clip={clip} />}
        {preset.params.map((spec) => (
          <ParamControl key={spec.key} spec={spec} value={clip.params[spec.key] ?? spec.default} onChange={(v) => updateClip(id, (c) => { c.params[spec.key] = v })} />
        ))}
      </Section>
      <div className="space-y-2 p-3">
        <Button variant="outline" className="w-full" onClick={() => bake(id)} title={t('inspector.bakeHint')}>
          <KeyRound size={14} /> {t('inspector.bake')}
        </Button>
        <p className="text-[11px] text-ink-400">{t('inspector.bakeHint')}</p>
        <Button variant="danger" className="w-full" onClick={() => removeClip(id)}>
          <Trash2 size={14} /> {t('inspector.remove')}
        </Button>
      </div>
    </>
  )
}

/** Generic control for one preset parameter: presets never need custom UI code. */
function ParamControl({ spec, value, onChange }: { spec: ParamSpec; value: unknown; onChange: (v: number | string | boolean) => void }) {
  if (spec.type === 'number') {
    return <Slider label={spec.label} value={Number(value)} min={spec.min} max={spec.max} step={spec.step} unit={spec.unit} onChange={onChange} />
  }
  if (spec.type === 'boolean') return <Toggle label={spec.label} value={Boolean(value)} onChange={onChange} />
  return <Select label={spec.label} value={String(value)} options={spec.options} onChange={onChange} />
}

/** Click/drag on a miniature of the screen to choose the Screen Focus region. */
function FocusPicker({ clip }: { clip: Clip }) {
  const { t } = useTranslation()
  const project = useEditor((s) => s.project)
  const updateClip = useEditor((s) => s.updateClip)
  const ref = useRef<HTMLDivElement>(null)
  const dev = project.nodes.find((n): n is DeviceNode => n.type === 'device' && n.id === clip.target) ?? firstDevice(project)
  const asset = dev?.screen.assetId ? project.assets[dev.screen.assetId] : null
  const url = useBlobUrl(asset?.id)
  const fx = Number(clip.params.focusX ?? 0.5), fy = Number(clip.params.focusY ?? 0.35), size = Number(clip.params.size ?? 0.6)

  const pick = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    updateClip(clip.id, (c) => { c.params.focusX = +x.toFixed(3); c.params.focusY = +y.toFixed(3) })
  }

  return (
    <div className="space-y-1.5">
      <div
        ref={ref}
        className="relative mx-auto aspect-[9/19.5] w-[120px] cursor-crosshair overflow-hidden rounded-[14px] border-2 border-ink-600 bg-ink-950"
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); pick(e) }}
        onPointerMove={(e) => e.buttons && pick(e)}
      >
        {url && asset && (asset.kind === 'image'
          ? <img src={url} alt="" className={`pointer-events-none h-full w-full ${dev?.screen.fit === 'contain' ? 'object-contain' : dev?.screen.fit === 'fill' ? 'object-fill' : 'object-cover'}`} draggable={false} />
          : <video src={`${url}#t=0.1`} muted className="pointer-events-none h-full w-full object-cover" />)}
        <div
          className="pointer-events-none absolute rounded border-2 border-accent bg-accent/15 shadow-[0_0_0_999px_rgba(0,0,0,0.45)]"
          style={{ width: `${size * 100}%`, height: `${size * 100}%`, left: `${(fx - size / 2) * 100}%`, top: `${(fy - size / 2) * 100}%` }}
        />
      </div>
      <p className="text-center text-[11px] text-ink-400">{t('inspector.focusPick')}</p>
    </div>
  )
}
