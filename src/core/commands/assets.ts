import type { Asset, MusicAnalysis, Project } from '../schema/project'
import { edit } from './types'

/**
 * Registers imported media in the project and (optionally) puts it on a device screen.
 * Not a public command: importing needs the environment (browser File vs. local path),
 * but every environment funnels into this one function so behaviour stays identical.
 */
export function addAssetToProject(
  project: Project,
  asset: Asset,
  opts: { deviceId?: string; assign?: boolean; analysis?: MusicAnalysis | null } = {},
): Project {
  return edit(project, (d) => {
    d.assets[asset.id] = asset
    if (asset.kind === 'audio') {
      // A song becomes the project's music; the analysis is stored so it never re-runs silently.
      if (opts.assign !== false) {
        d.music = { assetId: asset.id, offset: 0, volume: 1, fadeIn: 0, fadeOut: 1.5, analysis: opts.analysis ?? null, accents: 'off' }
      }
      return
    }
    if (opts.assign !== false) {
      const dev = d.nodes.find((n) => n.type === 'device' && (!opts.deviceId || n.id === opts.deviceId))
      if (dev?.type === 'device') dev.screen.assetId = asset.id
    }
    // A screen recording longer than the scene usually means the user wants to show it all.
    if (asset.kind === 'video' && asset.duration && asset.duration > d.settings.duration) {
      d.settings.duration = Math.min(120, Math.ceil(asset.duration * 10) / 10)
    }
  }).project
}
