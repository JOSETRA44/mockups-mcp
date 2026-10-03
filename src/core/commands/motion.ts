import { z } from 'zod'
import { bakeClip, evaluateChannels } from '../animation/evaluate'
import { listChannels, setBaseChannel } from '../animation/channels'
import { frameScreenRegion } from '../camera/framing'
import { getPreset, PRESETS } from '../presets/registry'
import { defaultParams } from '../presets/types'
import { EaseId, ParamValue, type Keyframe, type Project } from '../schema/project'
import { aspectOf, CommandError, defineCommand, devicePose, edit, findDevice } from './types'

const presetIds = PRESETS.map((p) => p.id) as [string, ...string[]]

/** Validates params against the preset's ParamSpec so agents get precise errors. */
function checkParams(presetId: string, params: Record<string, unknown>) {
  const preset = getPreset(presetId)!
  for (const [k, v] of Object.entries(params)) {
    const spec = preset.params.find((s) => s.key === k)
    if (!spec) throw new CommandError('INVALID_ARGS', `Preset "${presetId}" has no param "${k}". Params: ${preset.params.map((s) => s.key).join(', ')}`)
    if (spec.type === 'number' && (typeof v !== 'number' || v < spec.min || v > spec.max)) {
      throw new CommandError('INVALID_ARGS', `Param "${k}" must be a number in [${spec.min}, ${spec.max}].`)
    }
    if (spec.type === 'select' && !spec.options.some((o) => o.value === v)) {
      throw new CommandError('INVALID_ARGS', `Param "${k}" must be one of: ${spec.options.map((o) => o.value).join(', ')}`)
    }
    if (spec.type === 'boolean' && typeof v !== 'boolean') throw new CommandError('INVALID_ARGS', `Param "${k}" must be a boolean.`)
  }
}

const growDuration = (d: Project, end: number) => {
  if (end > d.settings.duration) d.settings.duration = Math.ceil(end * 10) / 10
}

export const addMotion = defineCommand({
  name: 'add_motion',
  summary: 'Add a motion preset clip to the timeline',
  description:
    'Adds a preset (see catalog presets) as a live clip. Device presets target a device (default: first); camera presets always target the camera. ' +
    'Clips stack: entrance + floating + camera move is the typical recipe. The scene duration grows to fit. Returns clipId.',
  args: z.object({
    preset: z.enum(presetIds),
    target: z.string().optional().describe('Device id for device presets; ignored for camera presets'),
    start: z.number().min(0).default(0).describe('Seconds'),
    duration: z.number().min(0.1).max(120).optional().describe('Seconds (default: preset default)'),
    params: z.record(z.string(), ParamValue).default({}),
  }),
  run: (p, a, ctx) => {
    const preset = getPreset(a.preset)!
    const target = preset.target === 'camera' ? 'camera' : findDevice(p, a.target).id
    checkParams(a.preset, a.params)
    const clip = {
      id: ctx.newId(),
      presetId: a.preset,
      target,
      start: a.start,
      duration: a.duration ?? preset.defaultDuration,
      params: { ...defaultParams(preset), ...a.params },
    }
    const { project } = edit(p, (d) => {
      d.clips.push(clip)
      growDuration(d, clip.start + clip.duration)
    })
    return { project, result: { clipId: clip.id } }
  },
})

export const updateMotion = defineCommand({
  name: 'update_motion',
  summary: 'Change timing or params of a motion clip',
  description: 'Params are merged into the existing ones. Use the catalog to see each preset\'s params and ranges.',
  args: z.object({
    clipId: z.string(),
    start: z.number().min(0).optional(),
    duration: z.number().min(0.1).max(120).optional(),
    params: z.record(z.string(), ParamValue).optional(),
  }),
  run: (p, a) => {
    const clip = p.clips.find((c) => c.id === a.clipId)
    if (!clip) throw new CommandError('NOT_FOUND', `No clip "${a.clipId}".`)
    if (a.params) checkParams(clip.presetId, a.params)
    return edit(p, (d) => {
      const c = d.clips.find((x) => x.id === a.clipId)!
      if (a.start !== undefined) c.start = a.start
      if (a.duration !== undefined) c.duration = a.duration
      if (a.params) Object.assign(c.params, a.params)
      growDuration(d, c.start + c.duration)
    })
  },
})

export const removeMotion = defineCommand({
  name: 'remove_motion',
  summary: 'Remove motion clips',
  description: 'Removes one clip (clipId), every clip on a target (target), or all clips (all=true).',
  args: z.object({ clipId: z.string().optional(), target: z.string().optional(), all: z.boolean().default(false) }),
  run: (p, a) => {
    if (!a.clipId && !a.target && !a.all) throw new CommandError('INVALID_ARGS', 'Pass clipId, target or all=true.')
    return edit(p, (d) => {
      d.clips = d.clips.filter((c) => !(a.all || c.id === a.clipId || c.target === a.target))
    })
  },
})

export const bakeMotion = defineCommand({
  name: 'bake_motion',
  summary: 'Convert a live motion clip into keyframe tracks',
  description: 'Samples the clip at the project fps into absolute keyframes (replacing tracks on the same channels) and removes the clip. Irreversible except via undo.',
  args: z.object({ clipId: z.string() }),
  run: (p, a, ctx) => {
    if (!p.clips.some((c) => c.id === a.clipId)) throw new CommandError('NOT_FOUND', `No clip "${a.clipId}".`)
    const tracks = bakeClip(p, a.clipId, ctx.newId)
    return edit(p, (d) => {
      const paths = new Set(tracks.map((t) => t.path))
      d.tracks = d.tracks.filter((t) => !paths.has(t.path)).concat(tracks)
      d.clips = d.clips.filter((c) => c.id !== a.clipId)
    })
  },
})

function upsertKey(p: Project, path: string, key: Keyframe, ctx: { newId: () => string }, tolerance: number) {
  let track = p.tracks.find((t) => t.path === path)
  if (!track) {
    track = { id: ctx.newId(), path, keyframes: [] }
    p.tracks.push(track)
  }
  const hit = track.keyframes.find((k) => Math.abs(k.t - key.t) <= tolerance)
  if (hit) Object.assign(hit, key)
  else track.keyframes.push(key)
  track.keyframes.sort((x, y) => x.t - y.t)
}

const checkPath = (p: Project, path: string) => {
  if (!listChannels(p).includes(path)) {
    throw new CommandError('INVALID_ARGS', `Unknown channel "${path}". Valid: ${listChannels(p).join(', ')}`)
  }
}

export const setKeyframe = defineCommand({
  name: 'set_keyframe',
  summary: 'Insert or update one keyframe on a channel',
  description:
    'Channels are "<nodeId>.<channel>", e.g. "camera.distance", "camera.yaw", "<deviceId>.rotation.y", "<deviceId>.screen.zoom". ' +
    'A keyframe at (almost) the same time is replaced. ease = interpolation from this key to the next.',
  args: z.object({ path: z.string(), time: z.number().min(0), value: z.number(), ease: EaseId.default('easeInOut') }),
  run: (p, a, ctx) => {
    checkPath(p, a.path)
    return edit(p, (d) => upsertKey(d, a.path, { t: a.time, value: a.value, ease: a.ease }, ctx, 0.5 / d.settings.fps))
  },
})

export const removeKeyframes = defineCommand({
  name: 'remove_keyframes',
  summary: 'Remove keyframes (one key, a channel, a node or everything)',
  description: 'path + time removes one key; path alone clears a channel; nodeId clears all tracks of that node; all=true clears every track.',
  args: z.object({ path: z.string().optional(), time: z.number().optional(), nodeId: z.string().optional(), all: z.boolean().default(false) }),
  run: (p, a) =>
    edit(p, (d) => {
      if (a.all) return void (d.tracks = [])
      if (a.nodeId) return void (d.tracks = d.tracks.filter((t) => !t.path.startsWith(`${a.nodeId}.`)))
      if (!a.path) throw new CommandError('INVALID_ARGS', 'Pass path, nodeId or all=true.')
      if (a.time === undefined) return void (d.tracks = d.tracks.filter((t) => t.path !== a.path))
      const tol = 0.5 / d.settings.fps
      for (const t of d.tracks) if (t.path === a.path) t.keyframes = t.keyframes.filter((k) => Math.abs(k.t - a.time!) > tol)
      d.tracks = d.tracks.filter((t) => t.keyframes.length > 0)
    }),
})

export const setChannelValue = defineCommand({
  name: 'set_channel_value',
  summary: 'Set a channel value with auto-key semantics',
  description: 'If the channel already has keyframes, inserts/updates a keyframe at `time`; otherwise changes the base value. This is how the editor sliders behave.',
  args: z.object({ path: z.string(), value: z.number(), time: z.number().min(0).default(0) }),
  run: (p, a, ctx) => {
    checkPath(p, a.path)
    return edit(p, (d) => {
      if (d.tracks.some((t) => t.path === a.path && t.keyframes.length)) {
        upsertKey(d, a.path, { t: a.time, value: a.value, ease: 'easeInOut' }, ctx, 0.5 / d.settings.fps)
      } else {
        setBaseChannel(d, a.path, a.value)
      }
    })
  },
})

const CAMERA_FIELDS = ['yaw', 'pitch', 'distance', 'fov'] as const

const Waypoint = z.object({
  time: z.number().min(0).describe('Seconds'),
  yaw: z.number().optional(),
  pitch: z.number().optional(),
  distance: z.number().positive().optional(),
  fov: z.number().min(5).max(120).optional(),
  target: z.tuple([z.number(), z.number(), z.number()]).optional(),
  focus: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      size: z.number().min(0.05).max(3).default(0.5).describe('Region height as a fraction of the screen height; >1 frames wider than the screen'),
      w: z.number().min(0.05).max(3).optional().describe('Region width as a fraction of the screen width (default = size). Full-width UI (cards, buttons): ~0.95'),
      deviceId: z.string().optional(),
      face: z.number().min(0).max(1).default(1),
    })
    .strict()
    .optional()
    .describe('Frame a region of a device screen (UV from top-left). Overrides target/distance (and yaw/pitch when face>0).'),
  ease: EaseId.default('product').describe('Interpolation from this waypoint to the next'),
}).strict()

export const setCameraPath = defineCommand({
  name: 'set_camera_path',
  summary: 'Animate the camera through a list of waypoints (camera journey)',
  description:
    'Writes keyframe tracks for the camera rig. Each waypoint may set yaw/pitch/distance/fov/target, or "focus" on a screen region (e.g. a button at x=0.5,y=0.85). ' +
    'Unset fields carry over from the previous waypoint (the first falls back to the camera rest pose). ' +
    'replace=true (default) clears previous camera keyframes; clearCameraMotions also removes camera preset clips so they do not add on top.',
  args: z.object({
    waypoints: z.array(Waypoint).min(1).max(64),
    replace: z.boolean().default(true),
    clearCameraMotions: z.boolean().default(true),
  }),
  run: (p, a, ctx) => {
    const pts = [...a.waypoints].sort((x, y) => x.time - y.time)
    const base = evaluateChannels({ ...p, clips: [], tracks: [] }, 0)
    let prev = {
      yaw: base['camera.yaw'], pitch: base['camera.pitch'], distance: base['camera.distance'], fov: base['camera.fov'],
      target: [base['camera.target.x'], base['camera.target.y'], base['camera.target.z']] as [number, number, number],
    }
    const resolved = pts.map((w) => {
      const next = { ...prev, target: [...prev.target] as [number, number, number] }
      for (const f of CAMERA_FIELDS) if (w[f] !== undefined) next[f] = w[f]!
      if (w.target) next.target = w.target
      if (w.focus) {
        const dev = findDevice(p, w.focus.deviceId)
        const rig = frameScreenRegion(devicePose(dev), w.focus, { ...next, target: next.target }, aspectOf(p), w.focus.face)
        Object.assign(next, { target: rig.target, distance: rig.distance, yaw: rig.yaw, pitch: rig.pitch })
      }
      prev = next
      return { time: w.time, ease: w.ease, ...next }
    })
    const channels: Record<string, (r: (typeof resolved)[number]) => number> = {
      'camera.yaw': (r) => r.yaw, 'camera.pitch': (r) => r.pitch, 'camera.distance': (r) => r.distance, 'camera.fov': (r) => r.fov,
      'camera.target.x': (r) => r.target[0], 'camera.target.y': (r) => r.target[1], 'camera.target.z': (r) => r.target[2],
    }
    const { project } = edit(p, (d) => {
      if (a.replace) d.tracks = d.tracks.filter((t) => !t.path.startsWith('camera.'))
      if (a.clearCameraMotions) d.clips = d.clips.filter((c) => c.target !== 'camera')
      for (const [path, get] of Object.entries(channels)) {
        for (const r of resolved) upsertKey(d, path, { t: r.time, value: get(r), ease: r.ease }, ctx, 1e-4)
      }
      growDuration(d, resolved[resolved.length - 1].time)
    })
    return { project, result: { waypoints: resolved.length, tracks: Object.keys(channels) } }
  },
})
