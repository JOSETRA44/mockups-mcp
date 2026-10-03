import type { Asset, Project } from '../schema/project'
import { edit } from './types'

/**
 * Registers imported media in the project and (optionally) puts it on a device screen.
 * Not a public command: importing needs the environment (browser File vs. local path),
 * but every environment funnels into this one function so behaviour stays identical.
 */
export function addAssetToProject(project: Project, asset: Asset, opts: { deviceId?: string; assign?: boolean } = {}): Project {
  return edit(project, (d) => {
    d.assets[asset.id] = asset
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
