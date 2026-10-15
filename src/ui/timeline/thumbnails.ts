import { useEffect, useState } from 'react'
import { evaluate } from '@/core/animation/evaluate'
import type { Project } from '@/core/schema/project'
import { shotHoldTimes } from '@/core/shots/shots'
import { screenAssetIds } from '@/core/shots/media'
import { Engine } from '@/engine/Engine'
import { AssetSourceProvider } from '@/engine/sources/sources'

/**
 * Live shot thumbnails (Rotato-style pose cards). One small offscreen Engine renders each
 * shot at its hold moment. Results are cached by everything that affects the picture, and
 * renders are debounced and sequential so editing stays fluid.
 */
const W = 96
let engine: Engine | null = null
let provider: AssetSourceProvider | null = null
const cache = new Map<string, string>()
let queue: Promise<void> = Promise.resolve()

function renderer(aspect: number) {
  const h = Math.round(W / aspect)
  if (!engine) {
    engine = new Engine({ canvas: new OffscreenCanvas(W, h), width: W, height: h, pixelRatio: 2, preserveDrawingBuffer: true })
    provider = new AssetSourceProvider('preview')
    engine.setSources(provider)
  } else {
    engine.setSize(W, h, 2)
  }
  return { engine, provider: provider!, canvas: engine.renderer.domElement as unknown as OffscreenCanvas }
}

/** Everything except timing that changes how a shot looks. */
const sceneKey = (p: Project) =>
  JSON.stringify([p.nodes, p.settings.width, p.settings.height, p.settings.background, p.settings.lighting, Object.keys(p.assets)])

export function useShotThumbnails(project: Project): Record<string, string> {
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!project.shots.length) return
    let cancelled = false
    const timer = setTimeout(() => {
      queue = queue.then(async () => {
        if (cancelled) return
        const { engine: e, provider: prov, canvas } = renderer(project.settings.width / project.settings.height)
        prov.setAssets(project.assets)
        const used = screenAssetIds(project)
        await Promise.all(used.map((id) => prov.load(id)))
        const scene = sceneKey(project)
        const holds = shotHoldTimes(project.shots)
        const next: Record<string, string> = {}
        for (const [i, shot] of project.shots.entries()) {
          if (cancelled) return
          const key = scene + JSON.stringify({ ...shot, id: '', start: 0, duration: 0 })
          let url = cache.get(key)
          if (!url) {
            // Motions are excluded so the card shows the framing, not a mid-entrance pose.
            const still: Project = { ...project, clips: [], shots: [{ ...shot, start: 0, duration: 1, transition: 0 }] }
            const r = evaluate(still, Math.min(0.5, holds[i] - shot.start))
            await e.prepareSources(r, false)
            e.render(r)
            url = URL.createObjectURL(await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 }))
            cache.set(key, url)
          }
          next[shot.id] = url
        }
        if (!cancelled) setThumbs(next)
      }).catch((err) => console.warn('[thumbnails]', err))
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [project])
  return thumbs
}
