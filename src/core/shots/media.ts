import type { Asset, Project } from '../schema/project'

/**
 * What a device's screen shows at time t, and where in that media. Shots may carry their own
 * media (one screen or take per shot); otherwise the device's screen asset plays, looping
 * over its useful (trimmed) part.
 */
export function screenMediaAt(project: Project, deviceId: string, t: number): { assetId: string | null; mediaTime: number } {
  const firstDevice = project.nodes.find((n) => n.type === 'device')?.id
  let shotIndex = -1
  for (let i = 0; i < project.shots.length && project.shots[i].start <= t; i++) shotIndex = i
  // The shot playing now, or the first one before the story starts.
  const shot = project.shots[Math.max(0, shotIndex)]
  const framed = shot && (shot.deviceId ?? firstDevice) === deviceId
  if (shot?.media && framed) {
    const asset = project.assets[shot.media.assetId]
    const local = Math.max(0, t - shot.start) * shot.media.speed
    return { assetId: shot.media.assetId, mediaTime: clampToAsset(asset, shot.media.from + local) }
  }
  const node = project.nodes.find((n) => n.id === deviceId)
  const assetId = node?.type === 'device' ? node.screen.assetId : null
  const asset = assetId ? project.assets[assetId] : undefined
  return { assetId, mediaTime: loopInAsset(asset, t) }
}

const span = (a: Asset) => {
  const start = a.trim?.in ?? 0
  const end = a.trim?.out ?? a.duration ?? 0
  return { start, end: Math.max(start, end) }
}

/** Plays forward and holds the last useful frame (a take should end on its result). */
export function clampToAsset(asset: Asset | undefined, time: number) {
  if (!asset || asset.kind !== 'video') return 0
  const { end } = span(asset)
  return Math.max(0, Math.min(time, Math.max(0, end - 1 / 60)))
}

/** Loops over the trimmed part (background screen recordings). */
export function loopInAsset(asset: Asset | undefined, t: number) {
  if (!asset || asset.kind !== 'video') return 0
  const { start, end } = span(asset)
  const len = end - start
  return len > 0 ? start + (t % len) : start
}
