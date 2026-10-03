import { applyTransform, rotateXYZ, type Vec3 } from '../math'
import { screenSurfaceZ, type DeviceSpec } from '../devices/registry'
import { distanceToFit, type CameraRig } from './rig'

export interface ScreenRegion {
  /** Centre of the region in screen UV, 0..1 from the top-left corner. */
  x: number
  y: number
  /** Region height as a fraction of the screen height (0.1 = tight, 1 = whole screen). */
  size: number
  /**
   * Region width as a fraction of the screen width. Defaults to `size`. Most mobile UI
   * (cards, buttons, lists) spans the full width, so pass ~0.95 to keep it uncropped.
   */
  w?: number
}

export interface DevicePose {
  position: Vec3
  rotation: Vec3
  scale: number
  spec: DeviceSpec
}

/**
 * Camera rig that frames a region of a device's screen, facing the screen.
 * `face` blends between keeping `current` yaw/pitch (0) and facing the screen head-on (1).
 */
export function frameScreenRegion(
  device: DevicePose,
  region: ScreenRegion,
  current: CameraRig,
  aspect: number,
  face = 1,
): CameraRig {
  const { spec, position, rotation, scale } = device
  const local: Vec3 = [(region.x - 0.5) * spec.screen.width, (0.5 - region.y) * spec.screen.height, screenSurfaceZ(spec)]
  const target = applyTransform(local, position, rotation, scale)
  const normal = rotateXYZ([0, 0, 1], rotation)
  const faceYaw = (Math.atan2(normal[0], normal[2]) * 180) / Math.PI
  const facePitch = (Math.asin(Math.max(-1, Math.min(1, normal[1]))) * 180) / Math.PI
  const rectH = spec.screen.height * region.size * scale
  const rectW = spec.screen.width * (region.w ?? region.size) * scale
  return {
    target,
    yaw: current.yaw + (faceYaw - current.yaw) * face,
    pitch: current.pitch + (facePitch - current.pitch) * face,
    distance: distanceToFit(rectH, rectW, current.fov, aspect, 0.9),
    fov: current.fov,
  }
}

/** Camera rig that frames the whole device body at `fill` of the frame. */
export function frameDevice(device: DevicePose, current: CameraRig, aspect: number, fill = 0.62): CameraRig {
  const { spec, position, scale } = device
  return {
    target: [...position] as Vec3,
    yaw: current.yaw,
    pitch: current.pitch,
    distance: distanceToFit(spec.body.height * scale, spec.body.width * scale, current.fov, aspect, fill),
    fov: current.fov,
  }
}
