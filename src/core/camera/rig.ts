import { add3, deg2rad, type Vec3 } from '../math'

export interface CameraRig {
  target: Vec3
  /** Degrees around Y. 0 = camera on +Z looking toward -Z. */
  yaw: number
  /** Degrees. Positive = camera above the target, looking down. */
  pitch: number
  distance: number
  /** Vertical field of view in degrees. */
  fov: number
}

export function rigDirection(yaw: number, pitch: number): Vec3 {
  const y = deg2rad(yaw), p = deg2rad(pitch)
  return [Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)]
}

export function rigPosition(rig: CameraRig): Vec3 {
  const d = rigDirection(rig.yaw, rig.pitch)
  return add3(rig.target, [d[0] * rig.distance, d[1] * rig.distance, d[2] * rig.distance])
}

/**
 * Distance at which an object of `height` × `width` (world units) fills `fill` of the
 * frame, accounting for the output aspect ratio (width / height).
 */
export function distanceToFit(height: number, width: number, fovDeg: number, aspect: number, fill = 1) {
  const halfV = Math.tan(deg2rad(fovDeg) / 2)
  const halfH = halfV * aspect
  const dV = height / 2 / (halfV * fill)
  const dH = width / 2 / (halfH * fill)
  return Math.max(dV, dH)
}
