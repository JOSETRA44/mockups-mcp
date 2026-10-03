import type { CameraRig } from '../camera/rig'
import type { DeviceSpec } from '../devices/registry'
import type { Vec3 } from '../math'
import type { ParamValue } from '../schema/project'

export type ParamSpec =
  | { key: string; label: string; type: 'number'; min: number; max: number; step: number; default: number; unit?: string }
  | { key: string; label: string; type: 'select'; options: { value: string; label: string }[]; default: string }
  | { key: string; label: string; type: 'boolean'; default: boolean }

export type PresetParams = Record<string, ParamValue>

/** Static (un-animated) state a preset can use to size its motion to the scene. */
export interface PresetContext {
  aspect: number
  camera: CameraRig
  device: { position: Vec3; rotation: Vec3; scale: number; spec: DeviceSpec } | null
}

/**
 * One animated channel produced by a preset.
 * - `offset`: added on top of the base value (presets stack, e.g. Floating + Side Entrance)
 * - `absolute`: replaces the value while the clip is active
 * `sample` maps clip progress u ∈ [0,1] to a value; it is held outside that range.
 */
export interface PresetCurve {
  channel: string
  mode: 'offset' | 'absolute'
  sample: (u: number) => number
}

export interface Preset {
  id: string
  name: string
  description: string
  /** Which kind of node the preset drives. */
  target: 'device' | 'camera'
  category: 'entrance' | 'camera' | 'loop' | 'emphasis'
  defaultDuration: number
  params: ParamSpec[]
  build(params: PresetParams, ctx: PresetContext): PresetCurve[]
}

export const defaultParams = (preset: Preset): PresetParams =>
  Object.fromEntries(preset.params.map((p) => [p.key, p.default]))

/** Typed param readers that fall back to the spec default. */
export const num = (p: PresetParams, k: string, d = 0) => (typeof p[k] === 'number' ? (p[k] as number) : d)
export const str = (p: PresetParams, k: string, d = '') => (typeof p[k] === 'string' ? (p[k] as string) : d)
export const bool = (p: PresetParams, k: string, d = false) => (typeof p[k] === 'boolean' ? (p[k] as boolean) : d)
