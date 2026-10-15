import type { Vec3 } from '../math'
import { rigPosition } from '../camera/rig'
import { screenMediaAt } from '../shots/media'
import type {
  Background, CameraNode, DeviceNode, Lighting, Project, SceneNode, ScreenFit, Settings,
} from '../schema/project'

/**
 * Every animatable property is a flat numeric "channel" addressed by
 * `${nodeId}.${channel}`. Presets, keyframe tracks and the evaluator all speak
 * this one vocabulary, so new node types only need to declare their channels.
 */
interface Channel<N> {
  get(n: N): number
  set(n: N, v: number): void
}

const vec = <N>(pick: (n: N) => number[], i: number): Channel<N> => ({
  get: (n) => pick(n)[i],
  set: (n, v) => { pick(n)[i] = v },
})

export const DEVICE_CHANNELS: Record<string, Channel<DeviceNode>> = {
  'position.x': vec((n) => n.transform.position, 0),
  'position.y': vec((n) => n.transform.position, 1),
  'position.z': vec((n) => n.transform.position, 2),
  'rotation.x': vec((n) => n.transform.rotation, 0),
  'rotation.y': vec((n) => n.transform.rotation, 1),
  'rotation.z': vec((n) => n.transform.rotation, 2),
  scale: { get: (n) => n.transform.scale, set: (n, v) => { n.transform.scale = v } },
  'screen.zoom': { get: (n) => n.screen.zoom, set: (n, v) => { n.screen.zoom = v } },
  'screen.panX': { get: (n) => n.screen.panX, set: (n, v) => { n.screen.panX = v } },
  'screen.panY': { get: (n) => n.screen.panY, set: (n, v) => { n.screen.panY = v } },
}

export const CAMERA_CHANNELS: Record<string, Channel<CameraNode>> = {
  'target.x': vec((n) => n.target, 0),
  'target.y': vec((n) => n.target, 1),
  'target.z': vec((n) => n.target, 2),
  yaw: { get: (n) => n.yaw, set: (n, v) => { n.yaw = v } },
  pitch: { get: (n) => n.pitch, set: (n, v) => { n.pitch = v } },
  distance: { get: (n) => n.distance, set: (n, v) => { n.distance = v } },
  fov: { get: (n) => n.fov, set: (n, v) => { n.fov = v } },
}

export type ChannelMap = Record<string, number>

const tableFor = (node: SceneNode) => (node.type === 'device' ? DEVICE_CHANNELS : CAMERA_CHANNELS) as Record<string, Channel<SceneNode>>

export function baseChannels(project: Project): ChannelMap {
  const out: ChannelMap = {}
  for (const node of project.nodes) {
    for (const [ch, c] of Object.entries(tableFor(node))) out[`${node.id}.${ch}`] = c.get(node)
  }
  return out
}

/** Splits "nodeId.channel.sub" into the node and its channel (node ids contain no dots). */
export function parseChannelPath(path: string) {
  const i = path.indexOf('.')
  return i < 0 ? null : { nodeId: path.slice(0, i), channel: path.slice(i + 1) }
}

/** Every valid channel path in the project, for validation and discovery. */
export function listChannels(project: Project): string[] {
  return project.nodes.flatMap((n) => Object.keys(tableFor(n)).map((c) => `${n.id}.${c}`))
}

/** Writes a base (un-animated) value. Mutates — call inside an immer draft. Returns false for unknown paths. */
export function setBaseChannel(project: Project, path: string, value: number): boolean {
  const parsed = parseChannelPath(path)
  const node = parsed && project.nodes.find((n) => n.id === parsed.nodeId)
  const ch = node && tableFor(node)[parsed!.channel]
  if (!node || !ch) return false
  ch.set(node, value)
  return true
}

export interface ResolvedDevice {
  id: string
  deviceId: string
  finishId: string
  position: Vec3
  rotation: Vec3
  scale: number
  screen: { assetId: string | null; fit: ScreenFit; zoom: number; panX: number; panY: number; mediaTime: number }
}

export interface ResolvedCamera {
  position: Vec3
  target: Vec3
  fov: number
}

/** Everything the renderer needs for one frame: no time, no presets, just values. */
export interface ResolvedScene {
  time: number
  settings: Settings
  background: Background
  lighting: Lighting
  devices: ResolvedDevice[]
  camera: ResolvedCamera
}

export function resolveScene(project: Project, ch: ChannelMap, time: number): ResolvedScene {
  const devices: ResolvedDevice[] = []
  let camera: ResolvedCamera = { position: [0, 0, 6], target: [0, 0, 0], fov: 30 }
  for (const node of project.nodes) {
    const g = (c: string) => ch[`${node.id}.${c}`]
    if (node.type === 'device') {
      devices.push({
        id: node.id,
        deviceId: node.deviceId,
        finishId: node.finishId,
        position: [g('position.x'), g('position.y'), g('position.z')],
        rotation: [g('rotation.x'), g('rotation.y'), g('rotation.z')],
        scale: g('scale'),
        screen: {
          ...screenMediaAt(project, node.id, time),
          fit: node.screen.fit,
          zoom: g('screen.zoom'),
          panX: g('screen.panX'),
          panY: g('screen.panY'),
        },
      })
    } else {
      const target: Vec3 = [g('target.x'), g('target.y'), g('target.z')]
      const rig = { target, yaw: g('yaw'), pitch: g('pitch'), distance: Math.max(0.05, g('distance')), fov: g('fov') }
      camera = { position: rigPosition(rig), target, fov: rig.fov }
    }
  }
  return {
    time,
    settings: project.settings,
    background: project.settings.background,
    lighting: project.settings.lighting,
    devices,
    camera,
  }
}
