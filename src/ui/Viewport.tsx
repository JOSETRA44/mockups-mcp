import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImagePlus } from 'lucide-react'
import { baseChannels } from '@/core/animation/channels'
import { evaluate } from '@/core/animation/evaluate'
import { sampleKeyframes } from '@/core/animation/keyframes'
import { Engine } from '@/engine/Engine'
import { AssetSourceProvider } from '@/engine/sources/sources'
import { importIntoEditor } from '@/media/backend'
import { MusicPlayer } from '@/media/audio'
import { firstDevice, useEditor } from '@/state/editor'
import { usePlayback } from '@/state/playback'
import { notify } from './common/toast'

/** Value a slider would show for a channel: keyframed value at the playhead, else the rest value. */
function channelValue(path: string) {
  const project = useEditor.getState().project
  const track = project.tracks.find((t) => t.path === path && t.keyframes.length)
  return track ? sampleKeyframes(track.keyframes, usePlayback.getState().time) : baseChannels(project)[path] ?? 0
}

/** Adds `delta` to a channel through the same auto-key command the inspector uses. */
function nudge(path: string, delta: number) {
  useEditor.getState().exec('set_channel_value', { path, value: channelValue(path) + delta, time: usePlayback.getState().time })
}

/**
 * Real-time preview. Each animation frame: advance the playhead, evaluate the document
 * at that time and hand the result to the Engine — the same path the exporter uses.
 */
export function Viewport() {
  const { t } = useTranslation()
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const width = useEditor((s) => s.project.settings.width)
  const height = useEditor((s) => s.project.settings.height)
  const transparent = useEditor((s) => s.project.settings.background.kind === 'transparent')

  useEffect(() => {
    const canvas = canvasRef.current!
    const engine = new Engine({ canvas, width: 2, height: 2, pixelRatio: Math.min(2, devicePixelRatio) })
    const provider = new AssetSourceProvider('preview')
    engine.setSources(provider)
    const player = new MusicPlayer()
    engineRef.current = engine

    let raf = 0
    let last = performance.now()
    let lastAssets: unknown = null
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const project = useEditor.getState().project
      const pb = usePlayback.getState()
      let time = pb.time
      if (pb.playing) {
        // With music, the audio clock is the master so picture and sound never drift.
        const audioClock = project.music ? player.clock() : null
        time = audioClock ?? time + dt
        const dur = project.settings.duration
        if (time >= dur) {
          if (pb.loop) time %= dur
          else {
            time = dur
            pb.pause()
          }
        }
        pb.setTime(time)
      }
      if (project.assets !== lastAssets) {
        provider.setAssets(project.assets)
        lastAssets = project.assets
      }
      void player.sync(project, time, pb.playing)
      const scene = evaluate(project, Math.min(time, project.settings.duration))
      void engine.prepareSources(scene, pb.playing)
      engine.render(scene)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      player.stop()
      provider.dispose()
      engine.dispose()
      engineRef.current = null
    }
  }, [])

  // Fit the canvas inside the available area at the project's aspect ratio.
  useEffect(() => {
    const wrap = wrapRef.current!
    const fit = () => {
      const pad = 32
      const aw = Math.max(50, wrap.clientWidth - pad * 2)
      const ah = Math.max(50, wrap.clientHeight - pad * 2)
      const aspect = width / height
      const w = Math.floor(Math.min(aw, ah * aspect))
      const h = Math.floor(w / aspect)
      const canvas = canvasRef.current!
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      engineRef.current?.setSize(w, h, Math.min(2, devicePixelRatio))
    }
    const ro = new ResizeObserver(fit)
    ro.observe(wrap)
    fit()
    return () => ro.disconnect()
  }, [width, height])

  // Direct manipulation: drag rotates the device, shift-drag moves it, wheel zooms the camera.
  const drag = useRef<{ x: number; y: number; shift: boolean } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, shift: e.shiftKey }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    d.x = e.clientX
    d.y = e.clientY
    const { selection, project, select } = useEditor.getState()
    if (selection.kind === 'camera') {
      // Camera selected: orbit (drag) or pan the target (shift-drag) — builds camera journeys.
      if (d.shift) {
        const k = 0.004
        nudge('camera.target.x', -dx * k)
        nudge('camera.target.y', dy * k)
      } else {
        nudge('camera.yaw', -dx * 0.3)
        nudge('camera.pitch', dy * 0.3)
      }
      return
    }
    const devId = selection.kind === 'device' ? selection.id : firstDevice(project)?.id
    if (!devId) return
    if (selection.kind !== 'device') select({ kind: 'device', id: devId })
    if (d.shift) {
      nudge(`${devId}.position.x`, dx * 0.006)
      nudge(`${devId}.position.y`, -dy * 0.006)
    } else {
      nudge(`${devId}.rotation.y`, dx * 0.4)
      nudge(`${devId}.rotation.x`, dy * 0.4)
    }
  }
  const onWheel = (e: React.WheelEvent) => {
    const current = channelValue('camera.distance')
    nudge('camera.distance', Math.max(0.5, Math.min(40, current * (1 + e.deltaY * 0.001))) - current)
  }

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    try {
      await importIntoEditor(file)
    } catch (err) {
      notify((err as Error).message, 'error')
    }
  }

  return (
    <div
      ref={wrapRef}
      className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-ink-950"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <canvas
        ref={canvasRef}
        className={`rounded-sm shadow-[0_20px_80px_rgba(0,0,0,0.6)] ${transparent ? 'checker' : ''} cursor-grab active:cursor-grabbing`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        onWheel={onWheel}
        data-testid="viewport-canvas"
      />
      {dragOver && (
        <div className="pointer-events-none absolute inset-4 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-accent bg-accent-soft text-ink-100">
          <ImagePlus size={28} />
          {t('media.drop')}
        </div>
      )}
    </div>
  )
}
