import type { Vec3 } from '../math'
import { rigPosition } from '../camera/rig'
import type {
  Background, CameraNode, DeviceNode, Lighting, Project, ScreenFit, Settings,
} from '../schema/project'

/**
 * Every animatable property is a flat numeric "channel" addressed by
 * `${nodeId}.${channel}`. Presets, keyframe tracks and the evaluator all speak
 * this one vocabulary, so new node types only need to declare their channels.
 */
type Getter<N> = (n: N) => number

export const DEVICE_CHANNELS: Record<string, Getter<DeviceNode>> = {
  'position.x': (n) => n.transform.position[0],
  'position.y': (n) => n.transform.position[1],
  'position.z': (n) => n.transform.position[2],
  'rotation.x': (n) => n.transform.rotation[0],
  'rotation.y': (n) => n.transform.rotation[1],
  'rotation.z': (n) => n.transform.rotation[2],
  scale: (n) => n.transform.scale,
  'screen.zoom': (n) => n.screen.zoom,
  'screen.panX': (n) => n.screen.panX,
  'screen.panY': (n) => n.screen.panY,
}

export const CAMERA_CHANNELS: Record<string, Getter<CameraNode>> = {
  'target.x': (n) => n.target[0],
  'target.y': (n) => n.target[1],
  'target.z': (n) => n.target[2],
  yaw: (n) => n.yaw,
  pitch: (n) => n.pitch,
  distance: (n) => n.distance,
  fov: (n) => n.fov,
}

export type ChannelMap = Record<string, number>

export function baseChannels(project: Project): ChannelMap {
  const out: ChannelMap = {}
  for (const node of project.nodes) {
    const table = node.type === 'device' ? DEVICE_CHANNELS : CAMERA_CHANNELS
    for (const [ch, get] of Object.entries(table)) out[`${node.id}.${ch}`] = (get as Getter<typeof node>)(node)
  }
  return out
}

export interface ResolvedDevice {
  id: string
  deviceId: string
  finishId: string
  position: Vec3
  rotation: Vec3
  scale: number
  screen: { assetId: string | null; fit: ScreenFit; zoom: number; panX: number; panY: number }
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
          assetId: node.screen.assetId,
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
