import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { DeviceNode, ScreenRegion } from '@/core/schema/project'
import { firstDevice, useEditor } from '@/state/editor'
import { useBlobUrl } from '../common/useBlobUrl'

/**
 * "Frame this area": a miniature of the actual screen content where the user drags the
 * region the camera should show. The same picker serves shots and the Screen Focus motion.
 */
export function ScreenRegionPicker({ deviceId, assetId, region, onChange }: { deviceId?: string | null; assetId?: string | null; region: ScreenRegion; onChange: (r: ScreenRegion) => void }) {
  const { t } = useTranslation()
  const project = useEditor((s) => s.project)
  const ref = useRef<HTMLDivElement>(null)
  const dev = project.nodes.find((n): n is DeviceNode => n.type === 'device' && n.id === deviceId) ?? firstDevice(project)
  // The shot's own media wins (a take or still), else the device's default screen.
  const shown = assetId ?? dev?.screen.assetId
  const asset = shown ? project.assets[shown] ?? null : null
  const url = useBlobUrl(asset?.id)
  const w = region.w ?? region.size

  const pick = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    onChange({ ...region, x: +x.toFixed(3), y: +y.toFixed(3) })
  }
  const fit = dev?.screen.fit === 'contain' ? 'object-contain' : dev?.screen.fit === 'fill' ? 'object-fill' : 'object-cover'

  return (
    <div className="space-y-1.5">
      <div
        ref={ref}
        className="relative mx-auto aspect-[9/19.5] w-[132px] cursor-crosshair overflow-hidden rounded-[16px] border-2 border-ink-600 bg-ink-950"
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); pick(e) }}
        onPointerMove={(e) => e.buttons && pick(e)}
        data-testid="region-picker"
      >
        {!asset && <span className="absolute inset-x-3 top-1/2 -translate-y-1/2 text-center text-[10px] leading-snug text-ink-400">{t('inspector.focusPickEmpty')}</span>}
        {url && asset && (asset.kind === 'image'
          ? <img src={url} alt="" className={`pointer-events-none h-full w-full ${fit}`} draggable={false} />
          : <video src={`${url}#t=${asset.poster ?? 0.1}`} muted className="pointer-events-none h-full w-full object-cover" />)}
        <div
          className="pointer-events-none absolute rounded border-2 border-accent bg-accent/15 shadow-[0_0_0_999px_rgba(0,0,0,0.45)]"
          style={{ width: `${w * 100}%`, height: `${region.size * 100}%`, left: `${(region.x - w / 2) * 100}%`, top: `${(region.y - region.size / 2) * 100}%` }}
        />
      </div>
      <p className="text-center text-[11px] text-ink-400">{t('inspector.focusPick')}</p>
    </div>
  )
}
