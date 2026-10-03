import { distanceToFit } from './camera/rig'
import { DEVICES, getDevice } from './devices/registry'
import { getPreset } from './presets/registry'
import { defaultParams } from './presets/types'
import { PROJECT_VERSION, type Clip, type DeviceNode, type Project } from './schema/project'

export const uid = () =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).slice(0, 12)

export interface FormatPreset {
  id: string
  label: string
  width: number
  height: number
}

export const FORMATS: FormatPreset[] = [
  { id: '9:16', label: 'Story / Reel 9:16', width: 1080, height: 1920 },
  { id: '4:5', label: 'Feed 4:5', width: 1080, height: 1350 },
  { id: '1:1', label: 'Square 1:1', width: 1080, height: 1080 },
  { id: '16:9', label: 'Landscape 16:9', width: 1920, height: 1080 },
  { id: '16:9-4k', label: '4K 16:9', width: 3840, height: 2160 },
  { id: '9:16-4k', label: '4K 9:16', width: 2160, height: 3840 },
]

/** Camera distance that frames the device comfortably for an aspect ratio. */
export function heroDistance(deviceId: string, aspect: number, fov = 30) {
  const spec = getDevice(deviceId)
  return distanceToFit(spec.body.height, spec.body.width, fov, aspect, 0.62)
}

export function createDevice(deviceId = DEVICES[0].id): DeviceNode {
  const spec = getDevice(deviceId)
  return {
    id: `device-${uid()}`,
    type: 'device',
    name: spec.name,
    deviceId: spec.id,
    finishId: spec.finishes[0].id,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
    screen: { assetId: null, fit: 'cover', zoom: 1, panX: 0, panY: 0 },
  }
}

export function createClip(presetId: string, target: string, start: number): Clip {
  const preset = getPreset(presetId)
  if (!preset) throw new Error(`Unknown preset ${presetId}`)
  return { id: uid(), presetId, target, start, duration: preset.defaultDuration, params: defaultParams(preset) }
}

export function createProject(name = 'Untitled project'): Project {
  const device = createDevice()
  const width = 1080, height = 1920
  const now = Date.now()
  return {
    version: PROJECT_VERSION,
    id: uid(),
    name,
    createdAt: now,
    updatedAt: now,
    settings: {
      width,
      height,
      fps: 30,
      duration: 5,
      background: { kind: 'gradient', color: '#1b1f3a', color2: '#5b3df5', angle: 160 },
      lighting: { preset: 'studio', intensity: 1, environment: 1 },
    },
    nodes: [
      device,
      {
        id: 'camera',
        type: 'camera',
        name: 'Camera',
        target: [0, 0, 0],
        yaw: 0,
        pitch: 0,
        distance: heroDistance(device.deviceId, width / height),
        fov: 30,
      },
    ],
    assets: {},
    tracks: [],
    clips: [createClip('hero-reveal', device.id, 0), { ...createClip('floating', device.id, 2.2), duration: 2.8 }],
  }
}
