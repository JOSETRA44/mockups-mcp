import { evaluate } from '../animation/evaluate'
import { EASE_IDS } from '../animation/easing'
import { DEVICES, getDevice } from '../devices/registry'
import { FORMATS } from '../factory'
import { PRESETS } from '../presets/registry'
import type { Project } from '../schema/project'
import { TEMPLATES } from './templates'

const r = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d
const r3 = (v: number[]) => v.map((n) => r(n))

/** Compact, agent-friendly view of a project (ids, timing, values — no noise). */
export function describeProject(p: Project) {
  return {
    id: p.id,
    name: p.name,
    format: { width: p.settings.width, height: p.settings.height, fps: p.settings.fps, duration: p.settings.duration },
    background: p.settings.background,
    lighting: p.settings.lighting,
    devices: p.nodes.flatMap((n) =>
      n.type === 'device'
        ? [{
            id: n.id,
            model: n.deviceId,
            finish: n.finishId,
            position: r3(n.transform.position),
            rotation: r3(n.transform.rotation),
            scale: r(n.transform.scale),
            screen: { ...n.screen, asset: n.screen.assetId ? p.assets[n.screen.assetId]?.name ?? null : null },
          }]
        : [],
    ),
    camera: p.nodes.flatMap((n) => (n.type === 'camera' ? [{ target: r3(n.target), yaw: r(n.yaw), pitch: r(n.pitch), distance: r(n.distance), fov: r(n.fov) }] : []))[0],
    motions: [...p.clips]
      .sort((a, b) => a.start - b.start)
      .map((c) => ({ clipId: c.id, preset: c.presetId, target: c.target, start: r(c.start), end: r(c.start + c.duration), params: c.params })),
    keyframeTracks: p.tracks.map((t) => ({
      path: t.path,
      keys: t.keyframes.length,
      from: r(t.keyframes[0]?.t ?? 0),
      to: r(t.keyframes[t.keyframes.length - 1]?.t ?? 0),
      ...(t.keyframes.length <= 12 ? { keyframes: t.keyframes.map((k) => ({ t: r(k.t), v: r(k.value), ease: k.ease })) } : {}),
    })),
    assets: Object.values(p.assets).map((a) => ({
      id: a.id, kind: a.kind, name: a.name, width: a.width, height: a.height, ...(a.duration ? { duration: r(a.duration) } : {}),
    })),
  }
}

/** Resolved camera + device poses at given times: lets an agent "see" motion numerically. */
export function sampleScene(p: Project, times: number[]) {
  return times.map((t) => {
    const s = evaluate(p, t)
    return {
      time: r(t),
      camera: { position: r3(s.camera.position), target: r3(s.camera.target), fov: r(s.camera.fov) },
      devices: s.devices.map((d) => ({ id: d.id, position: r3(d.position), rotation: r3(d.rotation), scale: r(d.scale), screenZoom: r(d.screen.zoom) })),
    }
  })
}

/** Everything an agent needs to know to drive the editor, in one call. */
export function catalog() {
  return {
    units: 'World units: a phone is ~2 units tall. Angles in degrees. Times in seconds. Screen UV: x,y in 0..1 from top-left.',
    formats: FORMATS,
    devices: DEVICES.map((d) => ({ id: d.id, name: d.name, category: d.category, finishes: d.finishes.map((f) => f.id) })),
    presets: PRESETS.map((p) => ({
      id: p.id, name: p.name, description: p.description, target: p.target, category: p.category,
      defaultDuration: p.defaultDuration, params: p.params,
    })),
    templates: TEMPLATES.map(({ id, name, description, duration }) => ({ id, name, description, duration })),
    eases: EASE_IDS,
    channels: {
      device: ['position.x', 'position.y', 'position.z', 'rotation.x', 'rotation.y', 'rotation.z', 'scale', 'screen.zoom', 'screen.panX', 'screen.panY'],
      camera: ['target.x', 'target.y', 'target.z', 'yaw', 'pitch', 'distance', 'fov'],
    },
    deviceSpecs: DEVICES.map((d) => ({ id: d.id, body: getDevice(d.id).body, screen: getDevice(d.id).screen })),
  }
}
