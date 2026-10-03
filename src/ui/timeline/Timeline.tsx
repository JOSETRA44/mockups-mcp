import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Camera, KeyRound, Pause, Play, Repeat, SkipBack, Smartphone } from 'lucide-react'
import { getPreset } from '@/core/presets/registry'
import type { Clip, Project } from '@/core/schema/project'
import { useEditor } from '@/state/editor'
import { usePlayback } from '@/state/playback'

const LABEL_W = 120
const LANE_H = 26

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
    label: n.name,
    icon: n.type === 'camera' ? Camera : Smartphone,
    items: packLanes(project.clips.filter((c) => c.target === n.id)),
  }))
  return rows.sort((a, b) => (a.id === 'camera' ? 1 : 0) - (b.id === 'camera' ? 1 : 0))
}

export function Timeline() {
  const { t } = useTranslation()
  const project = useEditor((s) => s.project)
  const selection = useEditor((s) => s.selection)
  const { select, updateClip } = useEditor.getState()
  const playing = usePlayback((s) => s.playing)
  const loop = usePlayback((s) => s.loop)
  const areaRef = useRef<HTMLDivElement>(null)
  const [areaW, setAreaW] = useState(600)
  const duration = project.settings.duration
  const pxPerSec = areaW / duration

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

  /** Drag a clip body to move it, its right edge to change its length. Snaps to 0.05 s and the playhead. */
  const dragClip = (e: React.PointerEvent, clip: Clip, mode: 'move' | 'resize') => {
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    select({ kind: 'clip', id: clip.id })
    const x0 = e.clientX
    const { start, duration: len } = clip
    const snap = (v: number) => {
      const ph = usePlayback.getState().time
      if (Math.abs(v - ph) * pxPerSec < 6) return ph
      return Math.round(v / 0.05) * 0.05
    }
    const move = (ev: PointerEvent) => {
      const dt = (ev.clientX - x0) / pxPerSec
      updateClip(clip.id, (c) => {
        if (mode === 'move') c.start = Math.max(0, snap(start + dt))
        else c.duration = Math.max(0.2, snap(start + len + dt) - start)
      })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
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
    <section className="flex h-[210px] shrink-0 flex-col border-t border-ink-700 bg-ink-900" data-testid="timeline">
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
      </div>

      <div className="flex min-h-0 flex-1 overflow-y-auto">
        <div className="shrink-0 border-r border-ink-700" style={{ width: LABEL_W }}>
          <div className="h-6 border-b border-ink-700" />
          {rows.map((row) => {
            const lanes = Math.max(1, ...row.items.map((i) => i.lane + 1)) + (tracksByNode.has(row.id) ? 1 : 0)
            const Icon = row.icon
            return (
              <button
                key={row.id}
                onClick={() => select(row.id === 'camera' ? { kind: 'camera' } : { kind: 'device', id: row.id })}
                className="flex w-full items-start gap-1.5 border-b border-ink-800 px-2 pt-1.5 text-left text-xs text-ink-300 hover:text-white"
                style={{ height: lanes * LANE_H + 8 }}
              >
                <Icon size={13} className="mt-0.5 shrink-0" />
                <span className="truncate">{row.label}</span>
              </button>
            )
          })}
        </div>

        <div ref={areaRef} className="relative min-w-0 flex-1">
          <div className="relative h-6 cursor-ew-resize border-b border-ink-700" onPointerDown={scrub} onPointerMove={(e) => e.buttons && usePlayback.getState().setTime(timeAt(e.clientX))}>
            {ticks.map((s) => (
              <div key={s} className="absolute top-0 h-full border-l border-ink-700" style={{ left: s * pxPerSec }}>
                {Number.isInteger(s) && <span className="absolute left-1 top-1 text-[10px] tabular-nums text-ink-400">{s}s</span>}
              </div>
            ))}
          </div>

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
