/**
 * Device specs are pure data. The engine turns a spec into geometry (procedurally today,
 * from a GLB later); core math (e.g. Screen Focus framing) only needs the dimensions.
 * Units: 1 unit ≈ 7.4 cm, a phone is ~2 units tall.
 */
export type DeviceCategory = 'phone' | 'tablet' | 'laptop' | 'monitor' | 'watch' | 'browser'

export interface DeviceFinish {
  id: string
  name: string
  color: string
  metalness: number
  roughness: number
}

export interface DeviceSpec {
  id: string
  name: string
  category: DeviceCategory
  /** How the engine builds it. 'procedural-phone' today; 'glb' later. */
  builder: 'procedural-phone'
  body: { width: number; height: number; depth: number; cornerRadius: number }
  screen: { width: number; height: number; cornerRadius: number }
  island: 'dynamic' | 'punch-hole' | 'none'
  cameraBump: 'triple' | 'dual' | 'bar'
  finishes: DeviceFinish[]
}

const titanium: DeviceFinish[] = [
  { id: 'natural', name: 'Natural Titanium', color: '#b9b4ab', metalness: 0.85, roughness: 0.35 },
  { id: 'black', name: 'Black Titanium', color: '#2b2c2f', metalness: 0.8, roughness: 0.4 },
  { id: 'white', name: 'White Titanium', color: '#e6e4df', metalness: 0.7, roughness: 0.35 },
  { id: 'blue', name: 'Blue Titanium', color: '#3d4a5c', metalness: 0.8, roughness: 0.38 },
]

const aluminium: DeviceFinish[] = [
  { id: 'obsidian', name: 'Obsidian', color: '#1f2023', metalness: 0.6, roughness: 0.45 },
  { id: 'porcelain', name: 'Porcelain', color: '#ebe6dc', metalness: 0.4, roughness: 0.5 },
  { id: 'mint', name: 'Mint', color: '#bfe3d0', metalness: 0.4, roughness: 0.5 },
]

export const DEVICES: DeviceSpec[] = [
  {
    id: 'phone-pro',
    name: 'Phone Pro',
    category: 'phone',
    builder: 'procedural-phone',
    body: { width: 0.98, height: 2.0, depth: 0.105, cornerRadius: 0.165 },
    screen: { width: 0.9, height: 1.95, cornerRadius: 0.13 },
    island: 'dynamic',
    cameraBump: 'triple',
    finishes: titanium,
  },
  {
    id: 'phone-android',
    name: 'Phone Android',
    category: 'phone',
    builder: 'procedural-phone',
    body: { width: 0.95, height: 2.0, depth: 0.1, cornerRadius: 0.12 },
    screen: { width: 0.89, height: 1.94, cornerRadius: 0.09 },
    island: 'punch-hole',
    cameraBump: 'bar',
    finishes: aluminium,
  },
]

export function getDevice(id: string): DeviceSpec {
  return DEVICES.find((d) => d.id === id) ?? DEVICES[0]
}

/** Z of the screen surface in device-local space (slightly in front of the body). */
export const screenSurfaceZ = (spec: DeviceSpec) => spec.body.depth / 2 + 0.0015
