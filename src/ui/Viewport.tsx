import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImagePlus } from 'lucide-react'
import { evaluate } from '@/core/animation/evaluate'
import { Engine } from '@/engine/Engine'
import { AssetSourceProvider } from '@/engine/sources/sources'
import { importMedia } from '@/media/import'
import { firstDevice, useEditor } from '@/state/editor'
import { usePlayback } from '@/state/playback'
import { notify } from './common/toast'

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
        time += dt
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
      const scene = evaluate(project, Math.min(time, project.settings.duration))
      void engine.prepareSources(scene, pb.playing)
      engine.render(scene)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
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
    const { update, selection, project, select } = useEditor.getState()
    const devId = selection.kind === 'device' ? selection.id : firstDevice(project)?.id
    if (!devId) return
    if (selection.kind !== 'device') select({ kind: 'device', id: devId })
    update((p) => {
      const dev = p.nodes.find((n) => n.id === devId)
      if (dev?.type !== 'device') return
      if (d.shift) {
        const k = 0.006
        dev.transform.position[0] += dx * k
        dev.transform.position[1] -= dy * k
      } else {
        dev.transform.rotation[1] += dx * 0.4
        dev.transform.rotation[0] += dy * 0.4
      }
    })
  }
  const onWheel = (e: React.WheelEvent) => {
    useEditor.getState().update((p) => {
      const cam = p.nodes.find((n) => n.type === 'camera')
      if (cam?.type === 'camera') cam.distance = Math.max(1, Math.min(40, cam.distance * (1 + e.deltaY * 0.001)))
    })
  }

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    try {
      useEditor.getState().addAsset(await importMedia(file))
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
