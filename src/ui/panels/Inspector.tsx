import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { Crosshair, Diamond, KeyRound, Trash2 } from 'lucide-react'
import { baseChannels } from '@/core/animation/channels'
import { evaluateChannels } from '@/core/animation/evaluate'
import { sampleKeyframes } from '@/core/animation/keyframes'
import { runBatch } from '@/core/commands'
import { usePlayback } from '@/state/playback'
import { LooksSection, MusicInspector, ShotInspector, useEaseOptions } from './StoryInspectors'
import { ScreenRegionPicker } from './ScreenRegionPicker'
import { FORMATS, heroDistance } from '@/core/factory'
import { getPreset } from '@/core/presets/registry'
import type { ParamSpec } from '@/core/presets/types'
import type { CameraNode, Clip, DeviceNode, Lighting, Project, ScreenFit } from '@/core/schema/project'
import { firstDevice, useEditor, type Selection } from '@/state/editor'
import { Button, ColorInput, Section, Segmented, Select, Slider, Toggle } from '../common/controls'

export function Inspector() {
  const { t } = useTranslation()
  const selection = useEditor((s) => s.selection)
  const select = useEditor((s) => s.select)
  const devId = useEditor((s) => firstDevice(s.project)?.id)
  const tabs: { label: string; sel: Selection; active: boolean }[] = [
    { label: t('inspector.scene'), sel: { kind: 'scene' }, active: selection.kind === 'scene' },
    { label: t('sidebar.device'), sel: { kind: 'device', id: devId ?? '' }, active: selection.kind === 'device' },
    { label: t('inspector.camera'), sel: { kind: 'camera' }, active: selection.kind === 'camera' || selection.kind === 'shot' },
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
        {selection.kind === 'shot' && <ShotInspector id={selection.id} />}
        {selection.kind === 'music' && <MusicInspector />}
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
      <LooksSection />
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

/**
 * A slider bound to an animatable channel. Without keyframes it edits the rest pose;
 * once the channel has keyframes it edits (or creates) the key at the playhead — the
 * same `set_channel_value` command agents use. The diamond toggles a key at the playhead.
 */
function AnimSlider({ path, label, min, max, step = 0.01, unit }: { path: string; label: string; min: number; max: number; step?: number; unit?: string }) {
  const { t } = useTranslation()
  const project = useEditor((s) => s.project)
  const exec = useEditor((s) => s.exec)
  const track = project.tracks.find((tr) => tr.path === path && tr.keyframes.length > 0)
  const time = usePlayback((s) => (track ? s.time : 0))
  const value = track ? sampleKeyframes(track.keyframes, time) : baseChannels(project)[path] ?? 0
  const tol = 0.5 / project.settings.fps
  const keyHere = !!track?.keyframes.some((k) => Math.abs(k.t - time) <= tol)
  const now = () => usePlayback.getState().time
  return (
    <Slider
      label={label} value={value} min={min} max={max} step={step} unit={unit}
      onChange={(v) => exec('set_channel_value', { path, value: v, time: now() })}
      extra={
        <button
          title={keyHere ? t('inspector.removeKey') : t('inspector.addKey')}
          onClick={() =>
            keyHere
              ? exec('remove_keyframes', { path, time: now() })
              : exec('set_keyframe', { path, time: now(), value, ease: 'easeInOut' })
          }
          className={clsx('flex h-5 w-5 shrink-0 items-center justify-center', track ? 'text-amber-400' : 'text-ink-600 hover:text-ink-300')}
          data-testid={`key-${path}`}
        >
          <Diamond size={11} fill={keyHere ? 'currentColor' : 'none'} />
        </button>
      }
    />
  )
}

function TracksSection({ nodeId }: { nodeId: string }) {
  const { t } = useTranslation()
  const allTracks = useEditor((s) => s.project.tracks)
  const exec = useEditor((s) => s.exec)
  const tracks = allTracks.filter((tr) => tr.path.startsWith(`${nodeId}.`))
  if (!tracks.length) return null
  return (
    <Section
      title={t('inspector.tracks')}
      actions={<Button variant="danger" className="h-6 px-2 text-xs" onClick={() => exec('remove_keyframes', { nodeId })}>{t('inspector.clearTracks')}</Button>}
    >
      {tracks.map((x) => (
        <div key={x.id} className="flex justify-between text-xs">
          <span className="font-mono text-ink-300">{x.path.slice(nodeId.length + 1)}</span>
          <span className="text-ink-400">{x.keyframes.length} keys</span>
        </div>
      ))}
    </Section>
  )
}

function DeviceInspector({ id }: { id: string }) {
  const { t } = useTranslation()
  const node = useEditor((s) => s.project.nodes.find((n) => n.id === id)) as DeviceNode | undefined
  const assetName = useEditor((s) => (node?.screen.assetId ? s.project.assets[node.screen.assetId]?.name : null))
  const deviceCount = useEditor((s) => s.project.nodes.filter((n) => n.type === 'device').length)
  const exec = useEditor((s) => s.exec)
  if (!node) return null
  const axes = ['x', 'y', 'z'] as const

  return (
    <>
      <Section
        title={t('inspector.transform')}
        actions={<Button className="h-6 px-2 text-xs" onClick={() => exec('set_device', { deviceId: id, position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 })}>{t('inspector.reset')}</Button>}
      >
        {axes.map((a) => (
          <AnimSlider key={`p${a}`} path={`${id}.position.${a}`} label={`${t('inspector.position')} ${a.toUpperCase()}`} min={-4} max={4} />
        ))}
        {axes.map((a) => (
          <AnimSlider key={`r${a}`} path={`${id}.rotation.${a}`} label={`${t('inspector.rotation')} ${a.toUpperCase()}`} min={-180} max={180} step={1} unit="°" />
        ))}
        <AnimSlider path={`${id}.scale`} label={t('inspector.scale')} min={0.2} max={3} />
      </Section>

      <Section title={t('inspector.screen')}>
        <p className="truncate text-xs text-ink-400">{assetName ?? t('inspector.noMedia')}</p>
        <Segmented
          value={node.screen.fit}
          options={(['cover', 'contain', 'fill'] as ScreenFit[]).map((f) => ({ value: f, label: t(`inspector.${f}`) }))}
          onChange={(f) => exec('set_screen', { deviceId: id, fit: f })}
        />
        <AnimSlider path={`${id}.screen.zoom`} label={t('inspector.zoom')} min={1} max={4} />
        <AnimSlider path={`${id}.screen.panX`} label={t('inspector.panX')} min={-0.5} max={0.5} />
        <AnimSlider path={`${id}.screen.panY`} label={t('inspector.panY')} min={-0.5} max={0.5} />
      </Section>

      <TracksSection nodeId={id} />
      {deviceCount > 1 && (
        <div className="p-3">
          <Button variant="danger" className="w-full" onClick={() => exec('remove_device', { deviceId: id }) && useEditor.getState().select({ kind: 'scene' })}>
            <Trash2 size={14} /> {t('inspector.removeDevice')}
          </Button>
        </div>
      )}
    </>
  )
}

const CAMERA_PATHS = ['camera.yaw', 'camera.pitch', 'camera.distance', 'camera.fov', 'camera.target.x', 'camera.target.y', 'camera.target.z']

function CameraInspector() {
  const { t } = useTranslation()
  const project = useEditor((s) => s.project)
  const exec = useEditor((s) => s.exec)
  const hasPath = project.tracks.some((tr) => tr.path.startsWith('camera.'))

  /** Keys every camera channel at the playhead with its current value: the camera-journey workflow. */
  const keyCamera = () => {
    const time = usePlayback.getState().time
    const current = useEditor.getState().project
    const values = evaluateChannels(current, time)
    const steps = CAMERA_PATHS.map((path) => ({ command: 'set_keyframe', args: { path, time, value: values[path], ease: 'product' } }))
    useEditor.setState({ project: runBatch(current, steps).project })
  }

  return (
    <>
      <Section
        title={t('inspector.camera')}
        actions={
          <Button className="h-6 px-2 text-xs" onClick={() => exec('frame_device', { reset: true })}>
            <Crosshair size={12} /> {t('inspector.frameDevice')}
          </Button>
        }
      >
        <AnimSlider path="camera.yaw" label={t('inspector.yaw')} min={-180} max={180} step={1} unit="°" />
        <AnimSlider path="camera.pitch" label={t('inspector.pitch')} min={-80} max={80} step={1} unit="°" />
        <AnimSlider path="camera.distance" label={t('inspector.distance')} min={0.5} max={30} step={0.05} />
        <AnimSlider path="camera.fov" label={t('inspector.fov')} min={10} max={80} step={1} unit="°" />
        {(['x', 'y', 'z'] as const).map((a) => (
          <AnimSlider key={a} path={`camera.target.${a}`} label={`${t('inspector.target')} ${a.toUpperCase()}`} min={-3} max={3} />
        ))}
      </Section>
      <div className="space-y-2 p-3">
        <Button variant="outline" className="w-full" onClick={keyCamera} data-testid="key-camera">
          <Diamond size={13} /> {t('inspector.keyCamera')}
        </Button>
        <p className="text-[11px] leading-relaxed text-ink-400">{hasPath ? t('inspector.pathHintActive') : t('inspector.pathHint')}</p>
      </div>
      <TracksSection nodeId="camera" />
    </>
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
  const easeOptions = useEaseOptions()
  if (spec.type === 'number') {
    return <Slider label={spec.label} value={Number(value)} min={spec.min} max={spec.max} step={spec.step} unit={spec.unit} onChange={onChange} />
  }
  if (spec.type === 'boolean') return <Toggle label={spec.label} value={Boolean(value)} onChange={onChange} />
  return <Select label={spec.label} value={String(value)} options={spec.key === 'ease' ? easeOptions : spec.options} onChange={onChange} />
}

/** Screen Focus motion: the shared region picker, bound to the clip params. */
function FocusPicker({ clip }: { clip: Clip }) {
  const updateClip = useEditor((s) => s.updateClip)
  const size = Number(clip.params.size ?? 0.6)
  const region = { x: Number(clip.params.focusX ?? 0.5), y: Number(clip.params.focusY ?? 0.35), size, w: Number(clip.params.width ?? size) }
  return (
    <ScreenRegionPicker
      deviceId={clip.target}
      region={region}
      onChange={(r) => updateClip(clip.id, (c) => { c.params.focusX = r.x; c.params.focusY = r.y })}
    />
  )
}
