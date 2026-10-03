import { z } from 'zod'
import { frameDevice } from '../camera/framing'
import { DEVICES, getDevice } from '../devices/registry'
import { createDevice, FORMATS } from '../factory'
import { EaseId, ScreenFit } from '../schema/project'
import { aspectOf, CommandError, defineCommand, devicePose, edit, findCamera, findDevice } from './types'

const Vec3 = z.tuple([z.number(), z.number(), z.number()])
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a #RRGGBB colour')

export const renameProject = defineCommand({
  name: 'rename_project',
  summary: 'Rename the project',
  description: 'Sets the human-readable project name (also used for export file names).',
  args: z.object({ name: z.string().min(1).max(120) }),
  run: (p, a) => edit(p, (d) => { d.name = a.name }),
})

export const setFormat = defineCommand({
  name: 'set_format',
  summary: 'Set output format, frame rate and duration',
  description:
    `Change the canvas size, fps or scene duration. "format" picks a preset (${FORMATS.map((f) => f.id).join(', ')}); ` +
    'or pass width/height directly (even numbers). Changing the aspect ratio re-frames the camera on the first device unless reframe=false.',
  args: z.object({
    format: z.enum(FORMATS.map((f) => f.id) as [string, ...string[]]).optional(),
    width: z.number().int().min(16).max(7680).optional(),
    height: z.number().int().min(16).max(7680).optional(),
    fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(50), z.literal(60)]).optional(),
    duration: z.number().min(0.5).max(120).optional().describe('Seconds'),
    reframe: z.boolean().default(true),
  }),
  run: (p, a) =>
    edit(p, (d) => {
      const before = aspectOf(d)
      const f = a.format ? FORMATS.find((x) => x.id === a.format) : undefined
      if (f) { d.settings.width = f.width; d.settings.height = f.height }
      if (a.width) d.settings.width = a.width
      if (a.height) d.settings.height = a.height
      if (a.fps) d.settings.fps = a.fps
      if (a.duration) d.settings.duration = a.duration
      if (a.reframe && Math.abs(aspectOf(d) - before) > 1e-6) {
        const dev = d.nodes.find((n) => n.type === 'device')
        const cam = findCamera(d)
        if (dev?.type === 'device') cam.distance = frameDevice(devicePose(dev), cam, aspectOf(d)).distance
      }
    }),
})

export const setBackground = defineCommand({
  name: 'set_background',
  summary: 'Set the background (gradient, solid or transparent)',
  description: 'Transparent backgrounds keep alpha in WebM and PNG-sequence exports (MP4 has no alpha). Gradient angle follows CSS: 180 = top→bottom.',
  args: z.object({
    kind: z.enum(['solid', 'gradient', 'transparent']).optional(),
    color: hex.optional(),
    color2: hex.optional(),
    angle: z.number().min(0).max(360).optional(),
  }),
  run: (p, a) => edit(p, (d) => { Object.assign(d.settings.background, stripUndefined(a)) }),
})

export const setLighting = defineCommand({
  name: 'set_lighting',
  summary: 'Set the lighting preset and intensities',
  description: 'Presets: studio (balanced), soft (low contrast), dramatic (strong rim light, dark reflections). intensity scales lights, environment scales reflections.',
  args: z.object({
    preset: z.enum(['studio', 'soft', 'dramatic']).optional(),
    intensity: z.number().min(0).max(5).optional(),
    environment: z.number().min(0).max(5).optional(),
  }),
  run: (p, a) => edit(p, (d) => { Object.assign(d.settings.lighting, stripUndefined(a)) }),
})

export const addDevice = defineCommand({
  name: 'add_device',
  summary: 'Add another device to the scene',
  description: `Adds a device node (models: ${DEVICES.map((x) => x.id).join(', ')}). Use position to place it, e.g. [1.3, 0, 0] to the right of a centred phone.`,
  args: z.object({
    model: z.enum(DEVICES.map((x) => x.id) as [string, ...string[]]).default(DEVICES[0].id),
    position: Vec3.optional(),
    rotation: Vec3.optional().describe('Euler degrees, XYZ'),
    scale: z.number().positive().optional(),
  }),
  run: (p, a) => {
    const node = createDevice(a.model)
    if (a.position) node.transform.position = a.position
    if (a.rotation) node.transform.rotation = a.rotation
    if (a.scale) node.transform.scale = a.scale
    const { project } = edit(p, (d) => { d.nodes.splice(d.nodes.length - 1, 0, node) })
    return { project, result: { deviceId: node.id } }
  },
})

export const removeDevice = defineCommand({
  name: 'remove_device',
  summary: 'Remove a device and its motions/keyframes',
  description: 'Deletes the device node plus every clip and keyframe track that targets it.',
  args: z.object({ deviceId: z.string() }),
  run: (p, a) => {
    findDevice(p, a.deviceId)
    if (p.nodes.filter((n) => n.type === 'device').length === 1) throw new CommandError('CONFLICT', 'A project needs at least one device.')
    return edit(p, (d) => {
      d.nodes = d.nodes.filter((n) => n.id !== a.deviceId)
      d.clips = d.clips.filter((c) => c.target !== a.deviceId)
      d.tracks = d.tracks.filter((t) => !t.path.startsWith(`${a.deviceId}.`))
    })
  },
})

export const setDevice = defineCommand({
  name: 'set_device',
  summary: "Change a device's model, finish or rest pose",
  description:
    'Sets the base (un-animated) pose. Units: ~2 world units = phone height; rotation in degrees (XYZ). ' +
    'Motions and keyframes animate on top of this pose. Omit deviceId to target the first device.',
  args: z.object({
    deviceId: z.string().optional(),
    model: z.enum(DEVICES.map((x) => x.id) as [string, ...string[]]).optional(),
    finish: z.string().optional().describe('Finish id, see catalog devices[].finishes'),
    position: Vec3.optional(),
    rotation: Vec3.optional(),
    scale: z.number().positive().max(10).optional(),
  }),
  run: (p, a) => {
    const target = findDevice(p, a.deviceId)
    return edit(p, (d) => {
      const dev = findDevice(d, target.id)
      if (a.model) {
        dev.deviceId = a.model
        dev.name = getDevice(a.model).name
        dev.finishId = getDevice(a.model).finishes[0].id
      }
      if (a.finish) {
        const spec = getDevice(dev.deviceId)
        if (!spec.finishes.some((f) => f.id === a.finish)) {
          throw new CommandError('INVALID_ARGS', `Unknown finish "${a.finish}" for ${spec.id}. Options: ${spec.finishes.map((f) => f.id).join(', ')}`)
        }
        dev.finishId = a.finish
      }
      if (a.position) dev.transform.position = a.position
      if (a.rotation) dev.transform.rotation = a.rotation
      if (a.scale) dev.transform.scale = a.scale
    })
  },
})

export const setScreen = defineCommand({
  name: 'set_screen',
  summary: 'Set what is shown on a device screen and how it fits',
  description:
    'assetId must be an asset already imported into the project (null clears the screen). fit: cover (fill, crop), contain (letterbox), fill (stretch). ' +
    'zoom/panX/panY zoom into the app content inside the screen (zoom 1 = none; pan in screen fractions, +Y moves down).',
  args: z.object({
    deviceId: z.string().optional(),
    assetId: z.string().nullable().optional(),
    fit: ScreenFit.optional(),
    zoom: z.number().min(0.25).max(8).optional(),
    panX: z.number().min(-1).max(1).optional(),
    panY: z.number().min(-1).max(1).optional(),
  }),
  run: (p, a) => {
    const target = findDevice(p, a.deviceId)
    if (a.assetId && !p.assets[a.assetId]) throw new CommandError('NOT_FOUND', `No asset "${a.assetId}". Import media first.`)
    return edit(p, (d) => {
      const { deviceId: _ignored, ...rest } = a
      Object.assign(findDevice(d, target.id).screen, stripUndefined(rest))
    })
  },
})

export const setCamera = defineCommand({
  name: 'set_camera',
  summary: 'Set the base camera (orbit rig)',
  description:
    'The camera orbits "target": yaw (deg, around Y; 0 = front), pitch (deg, + = above looking down), distance (world units), fov (vertical degrees; 20–35 looks product-like). ' +
    'This is the rest pose; camera motions and camera paths animate on top of / instead of it.',
  args: z.object({
    target: Vec3.optional(),
    yaw: z.number().min(-720).max(720).optional(),
    pitch: z.number().min(-89).max(89).optional(),
    distance: z.number().min(0.2).max(100).optional(),
    fov: z.number().min(5).max(120).optional(),
  }),
  run: (p, a) => edit(p, (d) => { Object.assign(findCamera(d), stripUndefined(a)) }),
})

export const frameDeviceCmd = defineCommand({
  name: 'frame_device',
  summary: 'Point the base camera at a device so it fills the frame',
  description: 'Resets target and distance so the device occupies `fill` of the frame height (0.62 is a comfortable hero framing). Keeps yaw/pitch unless reset=true.',
  args: z.object({
    deviceId: z.string().optional(),
    fill: z.number().min(0.1).max(1.5).default(0.62),
    reset: z.boolean().default(false).describe('Also reset yaw, pitch and fov to defaults'),
  }),
  run: (p, a) => {
    const dev = findDevice(p, a.deviceId)
    return edit(p, (d) => {
      const cam = findCamera(d)
      if (a.reset) { cam.yaw = 0; cam.pitch = 0; cam.fov = 30 }
      const rig = frameDevice(devicePose(dev), cam, aspectOf(d), a.fill)
      cam.target = rig.target
      cam.distance = rig.distance
    })
  },
})

export const EaseArg = EaseId

/** Object.assign helper that ignores undefined optional args. */
export function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>
}
