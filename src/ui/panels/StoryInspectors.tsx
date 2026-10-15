import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ArrowRight, Copy, KeyRound, Music2, Trash2, Wand2 } from 'lucide-react'
import { LOOKS, lookFromPalette, projectPalette } from '@/core/looks'
import type { ShotKind, ShotMove } from '@/core/schema/project'
import { useEditor } from '@/state/editor'
import { usePlayback } from '@/state/playback'
import { Button, Section, Segmented, Select, Slider } from '../common/controls'
import { notify } from '../common/toast'
import { SHOT_ICONS } from '../common/shotIcons'
import { useEaseOptions } from '../common/eases'
import { ScreenRegionPicker } from './ScreenRegionPicker'

const TRANSITIONS = [
  { id: 'cut', seconds: 0 },
  { id: 'quick', seconds: 0.4 },
  { id: 'smooth', seconds: 0.8 },
  { id: 'slow', seconds: 1.6 },
] as const

export function ShotInspector({ id }: { id: string }) {
  const { t } = useTranslation()
  const shots = useEditor((s) => s.project.shots)
  const nodes = useEditor((s) => s.project.nodes)
  const devices = nodes.filter((n) => n.type === 'device')
  const exec = useEditor((s) => s.exec)
  const easeOptions = useEaseOptions()
  const index = shots.findIndex((s) => s.id === id)
  const shot = shots[index]
  if (!shot) return null
  const set = (patch: Record<string, unknown>) => exec('update_shot', { shotId: id, ...patch })
  const transition = TRANSITIONS.reduce((best, x) => (Math.abs(x.seconds - shot.transition) < Math.abs(best.seconds - shot.transition) ? x : best))

  return (
    <>
      <Section title={t('shots.title', { n: index + 1 })}>
        <div className="grid grid-cols-5 gap-1">
          {(Object.keys(SHOT_ICONS) as ShotKind[]).map((k) => {
            const Icon = SHOT_ICONS[k]
            return (
              <button
                key={k}
                onClick={() => set({ kind: k })}
                className={clsx('flex flex-col items-center gap-1 rounded-md border py-1.5 text-[10px]', shot.kind === k ? 'border-accent bg-accent-soft text-white' : 'border-ink-700 text-ink-300 hover:bg-ink-800')}
                title={t(`shots.kindHints.${k}`)}
                data-testid={`shot-kind-${k}`}
              >
                <Icon size={14} />
                {t(`shots.kinds.${k}`)}
              </button>
            )
          })}
        </div>
        <p className="text-[11px] leading-relaxed text-ink-400">{t(`shots.kindHints.${shot.kind}`)}</p>
        {shot.kind === 'focus' ? (
          <>
            <ScreenRegionPicker deviceId={shot.deviceId} region={shot.region} onChange={(region) => set({ region })} />
            <Slider label={t('shots.regionHeight')} value={shot.region.size} min={0.08} max={1.2} onChange={(v) => set({ region: { ...shot.region, size: v } })} />
            <Slider label={t('shots.regionWidth')} value={shot.region.w ?? shot.region.size} min={0.08} max={1.2} onChange={(v) => set({ region: { ...shot.region, w: v } })} />
          </>
        ) : (
          <Slider label={t('shots.fill')} value={shot.fill} min={0.15} max={1.2} onChange={(v) => set({ fill: v })} />
        )}
        <Slider label={t('shots.yaw')} value={shot.yaw} min={-90} max={90} step={1} unit="°" onChange={(v) => set({ yaw: v })} />
        <Slider label={t('shots.pitch')} value={shot.pitch} min={-45} max={45} step={1} unit="°" onChange={(v) => set({ pitch: v })} />
        {devices.length > 1 && (
          <Select
            label={t('shots.device')}
            value={shot.deviceId ?? ''}
            options={[{ value: '', label: t('shots.firstDevice') }, ...devices.map((d) => ({ value: d.id, label: d.name }))]}
            onChange={(v) => set({ deviceId: v || null })}
          />
        )}
      </Section>

      <Section title={t('shots.motion')}>
        <Segmented
          value={shot.move}
          options={(['hold', 'push', 'pull', 'drift', 'orbit'] as ShotMove[]).map((m) => ({ value: m, label: t(`shots.moves.${m}`) }))}
          onChange={(move) => set({ move })}
        />
        {shot.move !== 'hold' && <Slider label={t('shots.amount')} value={shot.moveAmount} min={0} max={1} onChange={(v) => set({ moveAmount: v })} />}
        <Slider label={t('inspector.length')} value={shot.duration} min={0.3} max={12} step={0.05} unit="s" onChange={(v) => set({ duration: v })} />
      </Section>

      {index > 0 && (
        <Section title={t('shots.arrival')}>
          <Segmented
            value={transition.id}
            options={TRANSITIONS.map((x) => ({ value: x.id, label: t(`shots.transitions.${x.id}`) }))}
            onChange={(v) => set({ transition: TRANSITIONS.find((x) => x.id === v)!.seconds })}
          />
          {shot.transition > 0 && (
            <>
              <Slider label={t('shots.arrivalTime')} value={shot.transition} min={0.1} max={3} step={0.05} unit="s" onChange={(v) => set({ transition: v })} />
              <Select label={t('inspector.easing')} value={shot.ease} options={easeOptions} onChange={(v) => set({ ease: v })} />
            </>
          )}
          <p className="text-[11px] text-ink-400">{t('shots.arrivalHint')}</p>
        </Section>
      )}

      <div className="flex flex-wrap gap-1.5 p-3">
        <Button variant="outline" className="h-7 px-2 text-xs" onClick={() => exec('move_shot', { shotId: id, index: Math.max(0, index - 1) })} disabled={index === 0} title={t('shots.earlier')}><ArrowLeft size={13} /></Button>
        <Button variant="outline" className="h-7 px-2 text-xs" onClick={() => exec('move_shot', { shotId: id, index: index + 1 })} disabled={index === shots.length - 1} title={t('shots.later')}><ArrowRight size={13} /></Button>
        <Button
          variant="outline"
          className="h-7 px-2 text-xs"
          onClick={() => {
            const { id: _id, start: _s, ...rest } = shot
            const out = exec('add_shot', { ...rest, index: index + 1 })
            if (out?.shotId) useEditor.getState().select({ kind: 'shot', id: String(out.shotId) })
          }}
        >
          <Copy size={13} /> {t('shots.duplicate')}
        </Button>
        <Button variant="danger" className="h-7 px-2 text-xs" onClick={() => exec('remove_shot', { shotId: id }) && useEditor.getState().select({ kind: 'camera' })}>
          <Trash2 size={13} /> {t('inspector.remove')}
        </Button>
      </div>
      <Section title={t('shots.advanced')} defaultOpen={false}>
        <Button variant="outline" className="w-full" onClick={() => exec('bake_shots', {}) && useEditor.getState().select({ kind: 'camera' })}>
          <KeyRound size={14} /> {t('shots.bake')}
        </Button>
        <p className="text-[11px] text-ink-400">{t('shots.bakeHint')}</p>
      </Section>
    </>
  )
}

export function MusicInspector() {
  const { t } = useTranslation()
  const project = useEditor((s) => s.project)
  const exec = useEditor((s) => s.exec)
  const m = project.music
  if (!m) return <p className="p-3 text-xs text-ink-400">{t('music.none')}</p>
  const a = m.analysis
  const asset = project.assets[m.assetId]

  return (
    <>
      <Section title={t('music.title')}>
        <div className="flex items-center gap-2">
          <Music2 size={15} className="shrink-0 text-emerald-400" />
          <span className="truncate text-xs">{asset?.name}</span>
        </div>
        {a ? (
          <p className="text-[11px] text-ink-400">{t('music.summary', { bpm: Math.round(a.bpm), bars: a.bars.length, sections: a.sections.length })}</p>
        ) : (
          <p className="text-[11px] text-amber-300">{t('music.notAnalysed')}</p>
        )}
        <Button
          variant="primary"
          className="w-full"
          disabled={!a || !project.shots.length}
          onClick={() => exec('fit_to_music', {}) && notify(t('music.fitted'))}
        >
          <Wand2 size={14} /> {t('music.fit')}
        </Button>
        <p className="text-[11px] leading-relaxed text-ink-400">{project.shots.length ? t('music.fitHint') : t('music.fitNeedsShots')}</p>
      </Section>

      <Section title={t('music.accents')}>
        <Segmented
          value={m.accents}
          options={(['off', 'subtle', 'strong'] as const).map((v) => ({ value: v, label: t(`music.accentModes.${v}`) }))}
          onChange={(accents) => exec('set_music', { accents })}
        />
        <p className="text-[11px] leading-relaxed text-ink-400">{t('music.accentsHint')}</p>
      </Section>

      {a && a.sections.length > 1 && (
        <Section title={t('music.sectionsTitle')}>
          <p className="text-[11px] text-ink-400">{t('music.startHint')}</p>
          {a.sections.map((s) => (
            <button
              key={s.start}
              onClick={() => { exec('set_music', { offset: s.start }); usePlayback.getState().setTime(0) }}
              className={clsx('flex w-full items-center justify-between rounded-md px-2 py-1 text-xs hover:bg-ink-800', Math.abs(m.offset - s.start) < 0.05 && 'bg-emerald-500/10 text-emerald-200')}
            >
              <span>{t(`music.sections.${s.label}`, { defaultValue: s.label })}</span>
              <span className="flex items-center gap-2 tabular-nums text-ink-400">
                <span className="h-1.5 rounded-full bg-emerald-400/70" style={{ width: 8 + 40 * s.energy }} />
                {s.start.toFixed(1)}s
              </span>
            </button>
          ))}
        </Section>
      )}

      <Section title={t('music.mix')}>
        <Slider label={t('music.start')} value={m.offset} min={0} max={Math.max(1, (a?.duration ?? asset?.duration ?? 60) - 1)} step={0.05} unit="s" onChange={(v) => exec('set_music', { offset: v })} />
        <Slider label={t('music.volume')} value={m.volume} min={0} max={1.5} onChange={(v) => exec('set_music', { volume: v })} />
        <Slider label={t('music.fadeIn')} value={m.fadeIn} min={0} max={5} step={0.1} unit="s" onChange={(v) => exec('set_music', { fadeIn: v })} />
        <Slider label={t('music.fadeOut')} value={m.fadeOut} min={0} max={5} step={0.1} unit="s" onChange={(v) => exec('set_music', { fadeOut: v })} />
      </Section>

      {a && (
        <Section title={t('music.grid')} defaultOpen={false}>
          <p className="text-[11px] leading-relaxed text-ink-400">{t('music.gridHint')}</p>
          <Slider label="BPM" value={a.bpm} min={60} max={200} step={0.1} onChange={(v) => exec('set_tempo', { bpm: v, firstBeat: a.bars[0] ?? a.beats[0] ?? 0 })} />
          <div className="flex gap-1.5">
            <Button variant="outline" className="h-7 flex-1 px-2 text-xs" onClick={() => exec('set_tempo', { shiftDownbeat: 1 })}>{t('music.shiftBar')}</Button>
            <Button variant="outline" className="h-7 px-2 text-xs" onClick={() => exec('set_tempo', { nudge: -0.01 })}>−10ms</Button>
            <Button variant="outline" className="h-7 px-2 text-xs" onClick={() => exec('set_tempo', { nudge: 0.01 })}>+10ms</Button>
          </div>
        </Section>
      )}

      <div className="p-3">
        <Button variant="danger" className="w-full" onClick={() => exec('remove_music', {}) && useEditor.getState().select({ kind: 'scene' })}>
          <Trash2 size={14} /> {t('music.remove')}
        </Button>
      </div>
    </>
  )
}

/** One-click moods (Shots.so / Rotato) plus a look derived from the screenshot's colours. */
export function LooksSection() {
  const { t } = useTranslation()
  const project = useEditor((s) => s.project)
  const exec = useEditor((s) => s.exec)
  const match = lookFromPalette(projectPalette(project))
  const bg = project.settings.background
  const looks = [...(match ? [match] : []), ...LOOKS]
  return (
    <Section title={t('looks.title')}>
      <div className="grid grid-cols-4 gap-1.5">
        {looks.map((l) => {
          const active = bg.color === l.background.color && bg.color2 === l.background.color2 && bg.kind === l.background.kind
          return (
            <button
              key={l.id}
              onClick={() => exec('apply_look', { look: l.id })}
              className={clsx('flex flex-col items-center gap-1 rounded-md p-1 text-[10px]', active ? 'bg-ink-700 text-white' : 'text-ink-300 hover:bg-ink-800')}
              data-testid={`look-${l.id}`}
            >
              <span
                className={clsx('h-9 w-full rounded border', l.id === 'match-media' ? 'border-accent' : 'border-ink-600')}
                style={{ background: l.background.kind === 'gradient' ? `linear-gradient(${l.background.angle}deg, ${l.background.color}, ${l.background.color2})` : l.background.color }}
              />
              <span className="truncate">{l.id === 'match-media' ? t('looks.match') : l.name}</span>
            </button>
          )
        })}
      </div>
    </Section>
  )
}
