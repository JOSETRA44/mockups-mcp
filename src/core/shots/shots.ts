import { ease } from '../animation/easing'
import { frameDevice, frameScreenRegion, type DevicePose } from '../camera/framing'
import type { CameraRig } from '../camera/rig'
import { getDevice } from '../devices/registry'
import { clamp, lerp, rotateXYZ, type Vec3 } from '../math'
import type { CameraNode, DeviceNode, Project, Shot, ShotKind } from '../schema/project'

/**
 * Shots are the camera's story: a contiguous sequence of framings ("hero", "focus on this
 * area", "angle", "wide", "orbit"). Each shot describes *what* is shown, so it survives changes
 * to device pose, aspect ratio and model. Shots compile to camera values at evaluation time.
 */

/** Defaults that make each kind look right without touching any parameter. */
export const SHOT_DEFAULTS: Record<ShotKind, Omit<Shot, 'id' | 'start' | 'duration' | 'kind' | 'deviceId'>> = {
  hero: { region: { x: 0.5, y: 0.5, size: 1 }, yaw: 0, pitch: 0, fill: 0.62, move: 'push', moveAmount: 0.25, transition: 0.8, ease: 'product' },
  focus: { region: { x: 0.5, y: 0.35, size: 0.4, w: 0.95 }, yaw: 0, pitch: 0, fill: 0.62, move: 'drift', moveAmount: 0.3, transition: 0.7, ease: 'product' },
  angle: { region: { x: 0.5, y: 0.5, size: 1 }, yaw: -32, pitch: 10, fill: 0.58, move: 'drift', moveAmount: 0.5, transition: 0.9, ease: 'product' },
  wide: { region: { x: 0.5, y: 0.5, size: 1 }, yaw: -18, pitch: 6, fill: 0.4, move: 'pull', moveAmount: 0.3, transition: 0.9, ease: 'easeInOut' },
  orbit: { region: { x: 0.5, y: 0.5, size: 1 }, yaw: -20, pitch: 8, fill: 0.55, move: 'orbit', moveAmount: 0.5, transition: 0.9, ease: 'easeInOut' },
}

/** Recomputes starts from the order and durations: shots never overlap or leave gaps. */
export function layoutShots(shots: Shot[]): Shot[] {
  let t = 0
  return shots.map((s) => {
    const out = s.start === t ? s : { ...s, start: t }
    t += s.duration
    return out
  })
}

export const shotsEnd = (shots: Shot[]) => (shots.length ? shots[shots.length - 1].start + shots[shots.length - 1].duration : 0)

function devicePoseOf(project: Project, id: string | null): DevicePose | null {
  const devices = project.nodes.filter((n): n is DeviceNode => n.type === 'device')
  const d = (id && devices.find((x) => x.id === id)) || devices[0]
  if (!d) return null
  return { position: d.transform.position, rotation: d.transform.rotation, scale: d.transform.scale, spec: getDevice(d.deviceId) }
}

/** Camera rig for a shot at progress u ∈ [0,1] (u drives the in-shot move). */
export function shotRig(project: Project, shot: Shot, u: number): CameraRig | null {
  const device = devicePoseOf(project, shot.deviceId)
  const cam = project.nodes.find((n): n is CameraNode => n.type === 'camera')
  if (!device || !cam) return null
  const aspect = project.settings.width / project.settings.height
  const normal: Vec3 = rotateXYZ([0, 0, 1], device.rotation)
  const faceYaw = (Math.atan2(normal[0], normal[2]) * 180) / Math.PI
  const facePitch = (Math.asin(clamp(normal[1], -1, 1)) * 180) / Math.PI
  const view: CameraRig = { target: cam.target, yaw: faceYaw + shot.yaw, pitch: facePitch + shot.pitch, distance: cam.distance, fov: cam.fov }

  const rig =
    shot.kind === 'focus'
      ? { ...frameScreenRegion(device, shot.region, view, aspect, 0), yaw: view.yaw, pitch: view.pitch }
      : frameDevice(device, view, aspect, shot.fill)

  const a = clamp(shot.moveAmount, 0, 1)
  const smooth = ease('easeInOut', u)
  switch (shot.move) {
    case 'push': rig.distance *= 1 - 0.3 * a * smooth; break
    case 'pull': rig.distance *= 1 - 0.3 * a * (1 - smooth); break
    case 'drift': rig.yaw += 14 * a * (u - 0.5); rig.pitch += 3 * a * (u - 0.5); break
    case 'orbit': rig.yaw += 100 * a * (u - 0.5); break
  }
  return rig
}

/** Blends two rigs; distance in log space so zooms feel uniform. */
function blend(a: CameraRig, b: CameraRig, e: number): CameraRig {
  return {
    target: [lerp(a.target[0], b.target[0], e), lerp(a.target[1], b.target[1], e), lerp(a.target[2], b.target[2], e)],
    yaw: lerp(a.yaw, b.yaw, e),
    pitch: lerp(a.pitch, b.pitch, e),
    distance: Math.exp(lerp(Math.log(a.distance), Math.log(b.distance), e)),
    fov: lerp(a.fov, b.fov, e),
  }
}

const progress = (s: Shot, t: number) => clamp((t - s.start) / s.duration, 0, 1)

/**
 * Camera rig at time t. A shot's `start` is the arrival: its transition plays during
 * [start - transition, start] over the tail of the previous shot.
 */
export function evaluateShots(project: Project, t: number): CameraRig | null {
  const shots = project.shots
  if (!shots.length) return null
  let i = 0
  while (i + 1 < shots.length && shots[i + 1].start <= t) i++
  const cur = shots[i]
  const next = shots[i + 1]
  if (next && next.transition > 0) {
    const from = next.start - Math.min(next.transition, cur.duration)
    if (t >= from) {
      const a = shotRig(project, cur, progress(cur, t))
      const b = shotRig(project, next, 0)
      if (!a || !b) return a ?? b
      return blend(a, b, ease(next.ease, (t - from) / (next.start - from)))
    }
  }
  return shotRig(project, cur, progress(cur, t))
}

/** Times worth looking at: the middle of each shot's settled part (used by render_frames). */
export function shotHoldTimes(shots: Shot[]): number[] {
  return shots.map((s, i) => {
    const nextTransition = shots[i + 1]?.transition ?? 0
    const settledEnd = s.start + s.duration - Math.min(nextTransition, s.duration * 0.5)
    return +((s.start + settledEnd) / 2).toFixed(2)
  })
}
