import { z } from 'zod'

/**
 * The project document is the single source of truth: plain JSON, versioned, validated.
 * Preview, export and (later) a server renderer all consume exactly this shape.
 */
export const PROJECT_VERSION = 1

const Vec3 = z.tuple([z.number(), z.number(), z.number()])

export const Transform = z.object({
  position: Vec3,
  /** Euler degrees, XYZ order. */
  rotation: Vec3,
  scale: z.number(),
})

export const ScreenFit = z.enum(['cover', 'contain', 'fill'])

export const DeviceNode = z.object({
  id: z.string(),
  type: z.literal('device'),
  name: z.string(),
  deviceId: z.string(),
  finishId: z.string(),
  transform: Transform,
  screen: z.object({
    assetId: z.string().nullable(),
    fit: ScreenFit,
    /** 2D zoom/pan of the content inside the screen (1 = no zoom). */
    zoom: z.number(),
    panX: z.number(),
    panY: z.number(),
  }),
})

/** Orbit rig: presets animate yaw/pitch/distance instead of raw positions. */
export const CameraNode = z.object({
  id: z.literal('camera'),
  type: z.literal('camera'),
  name: z.string(),
  target: Vec3,
  yaw: z.number(),
  pitch: z.number(),
  distance: z.number(),
  fov: z.number(),
})

export const SceneNode = z.discriminatedUnion('type', [DeviceNode, CameraNode])

export const Background = z.object({
  kind: z.enum(['solid', 'gradient', 'transparent']),
  color: z.string(),
  color2: z.string(),
  /** Gradient angle in degrees. */
  angle: z.number(),
})

export const Lighting = z.object({
  preset: z.enum(['studio', 'soft', 'dramatic']),
  intensity: z.number(),
  environment: z.number(),
})

export const Settings = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().int().positive(),
  duration: z.number().positive(),
  background: Background,
  lighting: Lighting,
})

export const EaseId = z.enum([
  'linear',
  'easeIn',
  'easeOut',
  'easeInOut',
  'product',
  'expoOut',
  'backOut',
  'spring',
])

export const Keyframe = z.object({
  t: z.number(),
  value: z.number(),
  /** Interpolation from this keyframe to the next one. */
  ease: EaseId,
})

export const Track = z.object({
  id: z.string(),
  /** Channel path, e.g. "phone1.rotation.y" or "camera.distance". */
  path: z.string(),
  keyframes: z.array(Keyframe),
})

export const ParamValue = z.union([z.number(), z.string(), z.boolean()])

export const Clip = z.object({
  id: z.string(),
  presetId: z.string(),
  /** Node the preset drives ("camera" for camera presets). */
  target: z.string(),
  start: z.number(),
  duration: z.number().positive(),
  params: z.record(z.string(), ParamValue),
})

export const Asset = z.object({
  id: z.string(),
  kind: z.enum(['image', 'video']),
  name: z.string(),
  mime: z.string(),
  width: z.number(),
  height: z.number(),
  duration: z.number().optional(),
  hasAudio: z.boolean().optional(),
})

export const Project = z.object({
  version: z.literal(PROJECT_VERSION),
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  settings: Settings,
  nodes: z.array(SceneNode),
  assets: z.record(z.string(), Asset),
  tracks: z.array(Track),
  clips: z.array(Clip),
})

export type Transform = z.infer<typeof Transform>
export type DeviceNode = z.infer<typeof DeviceNode>
export type CameraNode = z.infer<typeof CameraNode>
export type SceneNode = z.infer<typeof SceneNode>
export type Background = z.infer<typeof Background>
export type Lighting = z.infer<typeof Lighting>
export type Settings = z.infer<typeof Settings>
export type EaseId = z.infer<typeof EaseId>
export type Keyframe = z.infer<typeof Keyframe>
export type Track = z.infer<typeof Track>
export type ParamValue = z.infer<typeof ParamValue>
export type Clip = z.infer<typeof Clip>
export type Asset = z.infer<typeof Asset>
export type Project = z.infer<typeof Project>
export type ScreenFit = z.infer<typeof ScreenFit>

/** Migrations keyed by the version they upgrade *from*. Add one per breaking change. */
const migrations: Record<number, (doc: any) => any> = {}

export function parseProject(raw: unknown): Project {
  let doc = raw as any
  while (doc && typeof doc.version === 'number' && doc.version < PROJECT_VERSION) {
    const migrate = migrations[doc.version]
    if (!migrate) throw new Error(`No migration from project version ${doc.version}`)
    doc = migrate(doc)
  }
  return Project.parse(doc)
}
