import { clamp } from '../math'
import { getDevice } from '../devices/registry'
import { getPreset } from '../presets/registry'
import type { PresetContext, PresetCurve } from '../presets/types'
import type { CameraNode, Clip, DeviceNode, Keyframe, Project, Track } from '../schema/project'
import { baseChannels, resolveScene, type ChannelMap, type ResolvedScene } from './channels'
import { sampleKeyframes } from './keyframes'

export function presetContext(project: Project, clip: Clip): PresetContext {
  const cam = project.nodes.find((n): n is CameraNode => n.type === 'camera')
  const devices = project.nodes.filter((n): n is DeviceNode => n.type === 'device')
  const dev = devices.find((d) => d.id === clip.target) ?? devices[0] ?? null
  return {
    aspect: project.settings.width / project.settings.height,
    camera: cam
      ? { target: cam.target, yaw: cam.yaw, pitch: cam.pitch, distance: cam.distance, fov: cam.fov }
      : { target: [0, 0, 0], yaw: 0, pitch: 0, distance: 6.5, fov: 30 },
    device: dev
      ? { position: dev.transform.position, rotation: dev.transform.rotation, scale: dev.transform.scale, spec: getDevice(dev.deviceId) }
      : null,
  }
}

/**
 * Curves are rebuilt only when the clip or the static scene changes. With immutable
 * updates (immer) a changed clip is a new object, so a WeakMap keyed by clip suffices;
 * the context key catches edits to the camera/device base pose.
 */
const curveCache = new WeakMap<Clip, { ctxKey: string; curves: PresetCurve[] }>()

export function clipCurves(project: Project, clip: Clip): PresetCurve[] {
  const preset = getPreset(clip.presetId)
  if (!preset) return []
  const ctx = presetContext(project, clip)
  const ctxKey = JSON.stringify(ctx, (k, v) => (k === 'spec' ? v.id : v))
  const hit = curveCache.get(clip)
  if (hit && hit.ctxKey === ctxKey) return hit.curves
  const curves = preset.build(clip.params, ctx)
  curveCache.set(clip, { ctxKey, curves })
  return curves
}

export const clipProgress = (clip: Clip, t: number) => clamp((t - clip.start) / clip.duration, 0, 1)

/**
 * Pure and deterministic: same project + same t → same frame. Layering order:
 *   1. base values from the document
 *   2. absolute preset curves (latest started clip wins; before any start, the first holds)
 *   3. keyframe tracks (advanced, override)
 *   4. offset preset curves, summed (this is what lets motions stack)
 */
export function evaluateChannels(project: Project, t: number): ChannelMap {
  const out = baseChannels(project)
  const offsets: ChannelMap = {}
  const absSet = new Set<string>()
  const clips = [...project.clips].sort((a, b) => a.start - b.start)

  for (const clip of clips) {
    const u = clipProgress(clip, t)
    for (const curve of clipCurves(project, clip)) {
      const path = `${clip.target}.${curve.channel}`
      if (!(path in out)) continue
      const v = curve.sample(u)
      if (curve.mode === 'offset') {
        offsets[path] = (offsets[path] ?? 0) + v
      } else if (t >= clip.start || !absSet.has(path)) {
        out[path] = v
        absSet.add(path)
      }
    }
  }

  for (const track of project.tracks) {
    if (track.keyframes.length && track.path in out) out[track.path] = sampleKeyframes(track.keyframes, t)
  }

  for (const [path, v] of Object.entries(offsets)) out[path] += v
  return out
}

export function evaluate(project: Project, t: number): ResolvedScene {
  return resolveScene(project, evaluateChannels(project, t), t)
}

/**
 * Converts a live preset clip into editable keyframe tracks (absolute values) sampled
 * at the project fps. Offsets are folded onto the base value at bake time.
 */
export function bakeClip(project: Project, clipId: string, newId: () => string): Track[] {
  const clip = project.clips.find((c) => c.id === clipId)
  if (!clip) return []
  const base = baseChannels(project)
  const steps = Math.max(2, Math.round(clip.duration * project.settings.fps))
  return clipCurves(project, clip).map((curve) => {
    const path = `${clip.target}.${curve.channel}`
    const keyframes: Keyframe[] = []
    for (let i = 0; i <= steps; i++) {
      const u = i / steps
      const v = curve.sample(u)
      keyframes.push({
        t: clip.start + u * clip.duration,
        value: curve.mode === 'offset' ? (base[path] ?? 0) + v : v,
        ease: 'linear',
      })
    }
    return { id: newId(), path, keyframes }
  })
}
