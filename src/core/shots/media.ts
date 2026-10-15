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
    const local = Math.max(0, t - shot.start) * effectiveSpeed(asset, shot.media, shot.duration)
    return { assetId: shot.media.assetId, mediaTime: clampToAsset(asset, shot.media.from + local) }
  }
  const node = project.nodes.find((n) => n.id === deviceId)
  const assetId = node?.type === 'device' ? node.screen.assetId : null
  const asset = assetId ? project.assets[assetId] : undefined
  return { assetId, mediaTime: loopInAsset(asset, t) }
}

/**
 * Playback speed of shot media. With fitTake the take's useful span is retimed to the shot
 * (so the payoff lands inside it), within a range that still looks natural.
 */
export function effectiveSpeed(asset: Asset | undefined, media: { from: number; speed: number; fitTake?: boolean }, shotDuration: number) {
  if (!media.fitTake || !asset || asset.kind !== 'video') return media.speed
  const { end } = span(asset)
  const useful = end - media.from
  return useful > 0 && shotDuration > 0 ? Math.min(1.6, Math.max(0.75, useful / shotDuration)) : media.speed
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

/** Every asset that can appear on a screen (device defaults + per-shot media): preload these before rendering. */
export function screenAssetIds(project: Project): string[] {
  const ids = new Set<string>()
  for (const n of project.nodes) if (n.type === 'device' && n.screen.assetId) ids.add(n.screen.assetId)
  for (const s of project.shots) if (s.media) ids.add(s.media.assetId)
  return [...ids].filter((id) => project.assets[id])
}
