import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Camera, Clapperboard, KeyRound, Magnet, Music2, Pause, Play, Plus, Repeat, SkipBack, Smartphone, Sparkles, Wand2,
  type LucideIcon,
} from 'lucide-react'
import { musicGrid, snapToGrid, type Grid } from '@/core/music/sync'
import { getPreset } from '@/core/presets/registry'
import type { Clip, Project, Shot } from '@/core/schema/project'
import { SHOT_ICONS } from '../common/shotIcons'
import { shotHoldTimes } from '@/core/shots/shots'
import { decodeAsset, peaks } from '@/media/audio'
import { importIntoEditor } from '@/media/backend'
import { useEditor } from '@/state/editor'
import { usePlayback } from '@/state/playback'
import { useUi } from '@/state/ui'
import { notify } from '../common/toast'
import { useShotThumbnails } from './thumbnails'

const LABEL_W = 120
const LANE_H = 26
const SHOT_H = 58
const MUSIC_H = 44

const fmt = (t: number) => {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`
}

/** Greedy lane packing so overlapping clips on the same node stay visible. */
function packLanes(clips: Clip[]): { clip: Clip; lane: number }[] {
  const lanesEnd: number[] = []
  return [...clips]
    .sort((a, b) => a.start - b.start)
    .map((clip) => {
      let lane = lanesEnd.findIndex((end) => end <= clip.start + 1e-6)
      if (lane === -1) lane = lanesEnd.length
      lanesEnd[lane] = clip.start + clip.duration
      return { clip, lane }
    })
}

function rowsOf(project: Project) {
  const rows = project.nodes.map((n) => ({
    id: n.id,
    label: n.type === 'camera' ? 'Camera moves' : n.name,
    icon: n.type === 'camera' ? Camera : Smartphone,
    items: packLanes(project.clips.filter((c) => c.target === n.id)),
  }))
  return rows.sort((a, b) => (a.id === 'camera' ? 1 : 0) - (b.id === 'camera' ? 1 : 0))
}

/**
 * Snapping, in order of priority: the playhead (6 px), then the musical grid (bars before
 * beats, within 12 px), then 0.05 s. Alt (or the magnet off) places freely, frame-accurate.
 */
function makeSnap(grid: Grid | null, pxPerSec: number, fps: number) {
  return (v: number, ev: { altKey: boolean }) => {
    const free = Math.round(v * fps) / fps
    if (ev.altKey || !useUi.getState().snap) return free
    const ph = usePlayback.getState().time
    if (Math.abs(v - ph) * pxPerSec < 6) return ph
    if (grid) {
      const g = snapToGrid(grid, v, { barWindow: 12 / pxPerSec })
      return Math.abs(g - v) * pxPerSec < 12 ? g : free
    }
    return Math.round(v / 0.05) * 0.05
  }
}

export function Timeline() {
  const { t } = useTranslation()
  const project = useEditor((s) => s.project)
  const selection = useEditor((s) => s.selection)
  const { select, updateClip, exec } = useEditor.getState()
  const playing = usePlayback((s) => s.playing)
  const loop = usePlayback((s) => s.loop)
  const snapOn = useUi((s) => s.snap)
  const areaRef = useRef<HTMLDivElement>(null)
  const [areaW, setAreaW] = useState(600)
  const duration = project.settings.duration
  const pxPerSec = areaW / duration
  const grid = useMemo(() => musicGrid(project), [project.music, project.settings.duration]) // eslint-disable-line react-hooks/exhaustive-deps
  const snap = makeSnap(grid, pxPerSec, project.settings.fps)

  useEffect(() => {
    const el = areaRef.current!
    const ro = new ResizeObserver(() => setAreaW(Math.max(100, el.clientWidth)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const timeAt = (clientX: number) => {
    const r = areaRef.current!.getBoundingClientRect()
    return Math.min(duration, Math.max(0, (clientX - r.left) / pxPerSec))
  }
  const scrub = (e: React.PointerEvent) => {
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    usePlayback.getState().pause()
    usePlayback.getState().setTime(timeAt(e.clientX))
  }

  /** Drag helper: calls onMove with the pointer delta in seconds until release. */
  const drag = (e: React.PointerEvent, onMove: (dt: number, ev: PointerEvent) => void) => {
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    const x0 = e.clientX
    const move = (ev: PointerEvent) => onMove((ev.clientX - x0) / pxPerSec, ev)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const dragClip = (e: React.PointerEvent, clip: Clip, mode: 'move' | 'resize') => {
    select({ kind: 'clip', id: clip.id })
    const { start, duration: len } = clip
    drag(e, (dt, ev) =>
      updateClip(clip.id, (c) => {
        if (mode === 'move') c.start = Math.max(0, snap(start + dt, ev))
        else c.duration = Math.max(0.2, snap(start + len + dt, ev) - start)
      }),
    )
  }

  /** Dragging a shot's right edge moves the cut: roll edit, so the rest of the story stays put. */
  const dragShotEdge = (e: React.PointerEvent, shot: Shot, index: number) => {
    select({ kind: 'shot', id: shot.id })
    const next = project.shots[index + 1]
    const max = next ? shot.duration + next.duration - 0.2 : 60
    drag(e, (dt, ev) => {
      const end = snap(shot.start + shot.duration + dt, ev)
      const d = Math.min(max, Math.max(0.2, end - shot.start))
      if (Math.abs(d - (useEditor.getState().project.shots[index]?.duration ?? 0)) > 1e-4) exec('update_shot', { shotId: shot.id, duration: +d.toFixed(4) })
    })
  }

  const rows = rowsOf(project)
  const ticks: number[] = []
  const step = pxPerSec > 80 ? 0.5 : pxPerSec > 30 ? 1 : 5
  for (let s = 0; s <= duration + 1e-6; s += step) ticks.push(+s.toFixed(2))
  const tracksByNode = new Map<string, { from: number; to: number; times: Set<number> }>()
  for (const tr of project.tracks) {
    if (!tr.keyframes.length) continue
    const node = tr.path.split('.')[0]
    const span = tracksByNode.get(node) ?? { from: Infinity, to: -Infinity, times: new Set<number>() }
    span.from = Math.min(span.from, tr.keyframes[0].t)
    span.to = Math.max(span.to, tr.keyframes[tr.keyframes.length - 1].t)
    for (const k of tr.keyframes) span.times.add(Math.round(k.t * 1000) / 1000)
    tracksByNode.set(node, span)
  }

  return (
    <section className="flex h-[300px] shrink-0 flex-col border-t border-ink-700 bg-ink-900" data-testid="timeline">
      <div className="flex h-10 items-center gap-1 border-b border-ink-700 px-2">
        <button className="flex h-7 w-7 items-center justify-center rounded-md text-ink-300 hover:bg-ink-800" onClick={() => usePlayback.getState().setTime(0)} title="Start">
          <SkipBack size={15} />
        </button>
        <button
          className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-white hover:bg-[#8d72ff]"
          onClick={() => {
            const pb = usePlayback.getState()
            if (!pb.playing && pb.time >= duration - 1e-3) pb.setTime(0)
            pb.toggle()
          }}
          title={playing ? t('timeline.pause') : t('timeline.play')}
          data-testid="play-toggle"
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button
          className={clsx('flex h-7 w-7 items-center justify-center rounded-md hover:bg-ink-800', loop ? 'text-accent' : 'text-ink-400')}
          onClick={() => usePlayback.getState().setLoop(!loop)}
          title={t('timeline.loop')}
        >
          <Repeat size={14} />
        </button>
        <TimeReadout />
        <span className="font-mono text-xs tabular-nums text-ink-400">/ {fmt(duration)}</span>
        <div className="flex-1" />
        {grid && (
          <button
            onClick={() => select({ kind: 'music' })}
            className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-ink-300 hover:bg-ink-800"
            title={t('timeline.musicSettings')}
          >
            <Music2 size={13} className="text-emerald-400" /> {Math.round(grid.bpm)} BPM
          </button>
        )}
        {grid && project.shots.length > 0 && (
          <button
            onClick={() => exec('fit_to_music', {}) && notify(t('music.fitted'))}
            className="flex h-7 items-center gap-1.5 rounded-md bg-emerald-500/15 px-2.5 text-xs font-medium text-emerald-200 hover:bg-emerald-500/25"
            data-testid="fit-to-music"
          >
            <Wand2 size={13} /> {t('music.fit')}
          </button>
        )}
        <button
          onClick={() => useUi.getState().setSnap(!snapOn)}
          className={clsx('flex h-7 w-7 items-center justify-center rounded-md hover:bg-ink-800', snapOn ? 'text-accent' : 'text-ink-500')}
          title={snapOn ? t('timeline.snapOn') : t('timeline.snapOff')}
          aria-pressed={snapOn}
        >
          <Magnet size={14} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 overflow-y-auto">
        <div className="shrink-0 border-r border-ink-700" style={{ width: LABEL_W }}>
          <div className="h-6 border-b border-ink-700" />
          <LaneLabel icon={Music2} label={t('timeline.music')} height={MUSIC_H} onClick={() => project.music && select({ kind: 'music' })} />
          <LaneLabel icon={Clapperboard} label={t('timeline.shots')} height={SHOT_H} onClick={() => select({ kind: 'camera' })} />
          {rows.map((row) => {
            const lanes = Math.max(1, ...row.items.map((i) => i.lane + 1)) + (tracksByNode.has(row.id) ? 1 : 0)
            return (
              <LaneLabel
                key={row.id}
                icon={row.icon}
                label={row.label}
                height={lanes * LANE_H + 8}
                onClick={() => select(row.id === 'camera' ? { kind: 'camera' } : { kind: 'device', id: row.id })}
              />
            )
          })}
        </div>

        <div ref={areaRef} className="relative min-w-0 flex-1">
          <BeatGrid grid={grid} pxPerSec={pxPerSec} duration={duration} />
          <div className="relative h-6 cursor-ew-resize border-b border-ink-700" onPointerDown={scrub} onPointerMove={(e) => e.buttons && usePlayback.getState().setTime(timeAt(e.clientX))}>
            {grid
              ? grid.bars.filter((b) => b <= duration).map((b, i) => (
                  <span key={b} className="absolute top-1 text-[10px] tabular-nums text-ink-400" style={{ left: b * pxPerSec + 3 }}>
                    {(i % Math.max(1, Math.round(28 / (grid.beat * 4 * pxPerSec))) === 0) ? i + 1 : ''}
                  </span>
                ))
              : ticks.map((s) => (
                  <div key={s} className="absolute top-0 h-full border-l border-ink-700" style={{ left: s * pxPerSec }}>
                    {Number.isInteger(s) && <span className="absolute left-1 top-1 text-[10px] tabular-nums text-ink-400">{s}s</span>}
                  </div>
                ))}
          </div>

          <MusicLane project={project} pxPerSec={pxPerSec} selected={selection.kind === 'music'} onScrub={scrub} />

          <ShotsLane
            project={project}
            pxPerSec={pxPerSec}
            selectedId={selection.kind === 'shot' ? selection.id : null}
            onEdge={dragShotEdge}
            onScrub={scrub}
          />

          {rows.map((row) => {
            const span = tracksByNode.get(row.id)
            const clipLanes = Math.max(1, ...row.items.map((i) => i.lane + 1))
            const lanes = clipLanes + (span ? 1 : 0)
            return (
              <div key={row.id} className="relative border-b border-ink-800" style={{ height: lanes * LANE_H + 8 }} onPointerDown={scrub}>
                {row.items.map(({ clip, lane }) => {
                  const preset = getPreset(clip.presetId)
                  const selected = selection.kind === 'clip' && selection.id === clip.id
                  return (
                    <div
                      key={clip.id}
                      onPointerDown={(e) => dragClip(e, clip, 'move')}
                      className={clsx(
                        'absolute flex cursor-grab items-center overflow-hidden rounded-md border px-2 text-[11px] font-medium active:cursor-grabbing',
                        preset?.target === 'camera' ? 'border-sky-400/40 bg-sky-500/20 text-sky-100' : 'border-accent/50 bg-accent/25 text-violet-100',
                        selected && 'ring-2 ring-white/80',
                      )}
                      style={{ left: clip.start * pxPerSec, width: Math.max(8, clip.duration * pxPerSec), top: 4 + lane * LANE_H, height: LANE_H - 4 }}
                      data-testid={`clip-${clip.presetId}`}
                    >
                      <span className="truncate">{preset?.name ?? clip.presetId}</span>
                      <span className="absolute inset-y-0 right-0 w-2 cursor-ew-resize hover:bg-white/30" onPointerDown={(e) => dragClip(e, clip, 'resize')} />
                    </div>
                  )
                })}
                {span && (
                  <div
                    className="absolute flex items-center gap-1 rounded-md border border-amber-400/40 bg-amber-500/15 px-2 text-[11px] text-amber-100"
                    style={{ left: span.from * pxPerSec, width: Math.max(8, (span.to - span.from) * pxPerSec), top: 4 + clipLanes * LANE_H, height: LANE_H - 4 }}
                    onPointerDown={(e) => { e.stopPropagation(); select(row.id === 'camera' ? { kind: 'camera' } : { kind: 'device', id: row.id }) }}
                  >
                    <KeyRound size={11} /> {span.times.size > 40 && t('timeline.keyframes')}
                  </div>
                )}
                {span && span.times.size <= 40 && [...span.times].map((kt) => (
                  <button
                    key={kt}
                    title={`${kt.toFixed(2)}s`}
                    onPointerDown={(e) => { e.stopPropagation(); usePlayback.getState().pause(); usePlayback.getState().setTime(kt) }}
                    className="absolute h-2.5 w-2.5 -translate-x-1/2 rotate-45 border border-amber-200 bg-amber-400 hover:scale-125"
                    style={{ left: kt * pxPerSec, top: 4 + clipLanes * LANE_H + (LANE_H - 4) / 2 - 5 }}
                    data-testid="keyframe-diamond"
                  />
                ))}
              </div>
            )
          })}

          <Playhead pxPerSec={pxPerSec} duration={duration} />
        </div>
      </div>
    </section>
  )
}

function LaneLabel({ icon: Icon, label, height, onClick }: { icon: LucideIcon; label: string; height: number; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-start gap-1.5 border-b border-ink-800 px-2 pt-1.5 text-left text-xs text-ink-300 hover:text-white" style={{ height }}>
      <Icon size={13} className="mt-0.5 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  )
}

/**
 * Final Cut–style grid: heavy lines at section changes, solid at bars, dashed beats only
 * when there is room to see them.
 */
function BeatGrid({ grid, pxPerSec, duration }: { grid: Grid | null; pxPerSec: number; duration: number }) {
  if (!grid) return null
  const showBeats = grid.beat * pxPerSec > 14
  const bars = new Set(grid.bars.map((b) => b.toFixed(3)))
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {showBeats && grid.beats.filter((b) => b <= duration && !bars.has(b.toFixed(3))).map((b) => (
        <div key={`b${b}`} className="absolute inset-y-0 border-l border-dashed border-ink-700/60" style={{ left: b * pxPerSec }} />
      ))}
      {grid.bars.filter((b) => b <= duration).map((b) => (
        <div key={`B${b}`} className="absolute inset-y-0 border-l border-ink-600/70" style={{ left: b * pxPerSec }} />
      ))}
      {grid.sections.slice(1).filter((s) => s.start <= duration).map((s) => (
        <div key={`S${s.start}`} className="absolute inset-y-0 border-l-2 border-emerald-400/50" style={{ left: s.start * pxPerSec }} />
      ))}
    </div>
  )
}

const SECTION_TINT: Record<string, string> = { intro: '#3b82f6', calm: '#3b82f6', build: '#a855f7', peak: '#f59e0b', outro: '#64748b', full: '#64748b' }

function MusicLane({ project, pxPerSec, selected, onScrub }: { project: Project; pxPerSec: number; selected: boolean; onScrub: (e: React.PointerEvent) => void }) {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const m = project.music
  const duration = project.settings.duration
  const width = Math.max(1, Math.round(duration * pxPerSec))
  const grid = musicGrid(project)

  useEffect(() => {
    if (!m) return
    let alive = true
    void decodeAsset(m.assetId).then((buffer) => {
      const c = canvasRef.current
      if (!alive || !buffer || !c) return
      const dpr = Math.min(2, devicePixelRatio)
      c.width = width * dpr
      c.height = MUSIC_H * dpr
      const g = c.getContext('2d')!
      g.scale(dpr, dpr)
      g.clearRect(0, 0, width, MUSIC_H)
      const p = peaks(buffer, Math.max(1, Math.floor(width / 2)), m.offset, m.offset + duration)
      g.fillStyle = 'rgba(167, 243, 208, 0.75)'
      const mid = MUSIC_H / 2
      p.forEach((v, i) => {
        const h = Math.max(1, v * (MUSIC_H - 10))
        g.fillRect(i * 2, mid - h / 2, 1.4, h)
      })
    })
    return () => { alive = false }
  }, [m, width, duration])

  const onFile = async (files: FileList | null) => {
    const f = files?.[0]
    if (!f) return
    setBusy(true)
    try {
      await importIntoEditor(f)
      notify(t('music.added'))
    } catch (err) {
      notify((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!m) {
    return (
      <div className="relative border-b border-ink-800" style={{ height: MUSIC_H }}>
        <button
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); void onFile(e.dataTransfer.files) }}
          className="absolute inset-1 flex items-center justify-center gap-2 rounded-md border border-dashed border-ink-600 text-xs text-ink-400 hover:border-emerald-400/60 hover:text-emerald-200"
          data-testid="add-music"
        >
          <Music2 size={13} /> {busy ? t('music.analysing') : t('music.add')}
        </button>
        <input ref={inputRef} type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac" hidden onChange={(e) => void onFile(e.target.files)} data-testid="music-input" />
      </div>
    )
  }

  return (
    <div
      className={clsx('relative cursor-pointer border-b border-ink-800', selected && 'bg-emerald-500/5')}
      style={{ height: MUSIC_H }}
      onPointerDown={(e) => { useEditor.getState().select({ kind: 'music' }); onScrub(e) }}
      data-testid="music-lane"
    >
      {grid?.sections.map((s) => (
        <div
          key={s.start}
          className="absolute inset-y-1 rounded-sm"
          style={{ left: Math.max(0, s.start) * pxPerSec, width: (Math.min(s.end, duration) - Math.max(0, s.start)) * pxPerSec, background: SECTION_TINT[s.label] ?? '#64748b', opacity: 0.12 + 0.18 * s.energy }}
        >
          <span className="absolute left-1 top-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/70">{t(`music.sections.${s.label}`, { defaultValue: s.label })}</span>
        </div>
      ))}
      <canvas ref={canvasRef} className="pointer-events-none absolute left-0 top-0" style={{ width, height: MUSIC_H }} />
      {!m.analysis && <span className="absolute right-2 top-1 text-[10px] text-ink-400">{t('music.notAnalysed')}</span>}
    </div>
  )
}

function ShotsLane({
  project, pxPerSec, selectedId, onEdge, onScrub,
}: { project: Project; pxPerSec: number; selectedId: string | null; onEdge: (e: React.PointerEvent, s: Shot, i: number) => void; onScrub: (e: React.PointerEvent) => void }) {
  const { t } = useTranslation()
  const thumbs = useShotThumbnails(project)
  const { exec, select } = useEditor.getState()
  const holds = shotHoldTimes(project.shots)
  const aspect = project.settings.width / project.settings.height
  const thumbW = Math.round((SHOT_H - 10) * aspect)

  if (!project.shots.length) {
    return (
      <div className="relative flex items-center gap-2 border-b border-ink-800 px-2" style={{ height: SHOT_H }} onPointerDown={onScrub}>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            const out = exec('create_storyboard', {})
            if (out?.shotIds) select({ kind: 'shot', id: String((out.shotIds as string[])[1] ?? (out.shotIds as string[])[0]) })
          }}
          className="flex h-8 items-center gap-1.5 rounded-md bg-accent/20 px-3 text-xs font-medium text-violet-100 hover:bg-accent/30"
          data-testid="create-storyboard"
        >
          <Sparkles size={13} /> {t('shots.storyboard')}
        </button>
        <span className="text-[11px] text-ink-400">{t('shots.emptyHint')}</span>
      </div>
    )
  }

  return (
    <div className="relative border-b border-ink-800" style={{ height: SHOT_H }} onPointerDown={onScrub}>
      {project.shots.map((s, i) => {
        const Icon = SHOT_ICONS[s.kind]
        const w = s.duration * pxPerSec
        const selected = selectedId === s.id
        return (
          <div
            key={s.id}
            onPointerDown={(e) => {
              e.stopPropagation()
              select({ kind: 'shot', id: s.id })
              usePlayback.getState().pause()
              usePlayback.getState().setTime(holds[i])
            }}
            className={clsx(
              'group absolute top-1 flex cursor-pointer items-stretch overflow-hidden rounded-md border bg-ink-850',
              selected ? 'border-white ring-1 ring-white/60' : 'border-indigo-400/40 hover:border-indigo-300',
            )}
            style={{ left: s.start * pxPerSec + 1, width: Math.max(10, w - 2), height: SHOT_H - 8 }}
            data-testid={`shot-${s.kind}`}
          >
            {s.transition > 0 && i > 0 && (
              <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-indigo-400/30 to-transparent" style={{ width: Math.min(w, s.transition * pxPerSec) }} />
            )}
            {thumbs[s.id] && w > thumbW + 12 && <img src={thumbs[s.id]} alt="" className="m-1 h-[calc(100%-8px)] shrink-0 rounded-sm object-cover" style={{ width: thumbW }} draggable={false} />}
            {w > 40 && (
              <div className="relative flex min-w-0 flex-col justify-center gap-0.5 px-1.5">
                <span className="flex items-center gap-1 text-[11px] font-medium text-indigo-100">
                  <Icon size={11} className="shrink-0" /> <span className="truncate">{t(`shots.kinds.${s.kind}`)}</span>
                </span>
                <span className="truncate text-[10px] text-ink-400">{t(`shots.moves.${s.move}`)}</span>
              </div>
            )}
            <span className="absolute inset-y-0 right-0 w-2 cursor-ew-resize hover:bg-white/30" onPointerDown={(e) => onEdge(e, s, i)} data-testid="shot-edge" />
          </div>
        )
      })}
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => {
          const out = exec('add_shot', { kind: 'focus', duration: 2 })
          if (out?.shotId) select({ kind: 'shot', id: String(out.shotId) })
        }}
        className="absolute top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-dashed border-ink-500 text-ink-300 hover:border-accent hover:text-white"
        style={{ left: Math.min(project.settings.duration * pxPerSec - 30, (project.shots[project.shots.length - 1].start + project.shots[project.shots.length - 1].duration) * pxPerSec + 4) }}
        title={t('shots.add')}
        data-testid="add-shot"
      >
        <Plus size={13} />
      </button>
    </div>
  )
}

/** Isolated subscribers so only these re-render on every playback frame. */
function TimeReadout() {
  const time = usePlayback((s) => s.time)
  return <span className="ml-2 font-mono text-xs tabular-nums text-ink-100">{fmt(time)}</span>
}

function Playhead({ pxPerSec, duration }: { pxPerSec: number; duration: number }) {
  const time = usePlayback((s) => s.time)
  return (
    <div className="pointer-events-none absolute inset-y-0 w-px bg-white" style={{ left: Math.min(time, duration) * pxPerSec }}>
      <div className="absolute -left-[5px] top-0 h-2.5 w-[11px] rounded-b-sm bg-white" />
    </div>
  )
}
