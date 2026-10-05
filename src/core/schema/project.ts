import { z } from 'zod'

/**
 * The project document is the single source of truth: plain JSON, versioned, validated.
 * Preview, export and (later) a server renderer all consume exactly this shape.
 */
export const PROJECT_VERSION = 2

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

/** A region of a device screen in UV (0..1 from the top-left). */
export const ScreenRegion = z.object({
  x: z.number(),
  y: z.number(),
  /** Height as a fraction of the screen height. */
  size: z.number(),
  /** Width as a fraction of the screen width (defaults to size). */
  w: z.number().optional(),
})

export const Asset = z.object({
  id: z.string(),
  kind: z.enum(['image', 'video', 'audio']),
  name: z.string(),
  mime: z.string(),
  width: z.number(),
  height: z.number(),
  duration: z.number().optional(),
  hasAudio: z.boolean().optional(),
  /** Dominant colours of an image/video (hex), used by "match media" looks. */
  palette: z.array(z.string()).optional(),
  /** UI blocks detected in the screenshot (cards, buttons), top to bottom: storyboard targets. */
  regions: z.array(ScreenRegion).optional(),
})

export const ShotKind = z.enum(['hero', 'focus', 'angle', 'wide', 'orbit'])
export const ShotMove = z.enum(['hold', 'push', 'pull', 'drift', 'orbit'])

/**
 * A shot: what the camera shows from `start` for `duration`. `start` is the moment the
 * camera *arrives* — the transition plays before it, over the tail of the previous shot —
 * so snapping starts to downbeats makes arrivals land on the music.
 */
export const Shot = z.object({
  id: z.string(),
  start: z.number(),
  duration: z.number().positive(),
  kind: ShotKind,
  /** Device to frame; null = the first device. */
  deviceId: z.string().nullable(),
  /** For "focus": the screen region to frame. */
  region: ScreenRegion,
  /** View direction relative to the device front (degrees). */
  yaw: z.number(),
  pitch: z.number(),
  /** For non-focus shots: fraction of the frame height the device fills. */
  fill: z.number(),
  /** Motion inside the shot and its amount (0..1). */
  move: ShotMove,
  moveAmount: z.number(),
  /** Seconds the camera takes to arrive (0 = cut). */
  transition: z.number(),
  ease: EaseId,
})

export const MusicSection = z.object({
  start: z.number(),
  end: z.number(),
  /** Relative loudness/density, 0..1 across the song. */
  energy: z.number(),
  label: z.string(),
})

/** Result of analysing a song. Stored so it never re-runs silently and stays editable. */
export const MusicAnalysis = z.object({
  analyzer: z.string(),
  duration: z.number(),
  bpm: z.number(),
  /** Beat times in song seconds. */
  beats: z.array(z.number()),
  /** Bar start times (downbeats) in song seconds, assuming 4/4. */
  bars: z.array(z.number()),
  sections: z.array(MusicSection),
})

export const Music = z.object({
  assetId: z.string(),
  /** Song time (seconds) that plays at project time 0. */
  offset: z.number(),
  volume: z.number(),
  fadeIn: z.number(),
  fadeOut: z.number(),
  analysis: MusicAnalysis.nullable(),
  /** Musical micro-motion on strong beats of high-energy sections. */
  accents: z.enum(['off', 'subtle', 'strong']),
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
  shots: z.array(Shot),
  music: Music.nullable(),
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
export type ScreenRegion = z.infer<typeof ScreenRegion>
export type Shot = z.infer<typeof Shot>
export type ShotKind = z.infer<typeof ShotKind>
export type ShotMove = z.infer<typeof ShotMove>
export type Music = z.infer<typeof Music>
export type MusicAnalysis = z.infer<typeof MusicAnalysis>
export type MusicSection = z.infer<typeof MusicSection>

/** Migrations keyed by the version they upgrade *from*. Add one per breaking change. */
const migrations: Record<number, (doc: any) => any> = {
  // v2: shots (camera story) and music.
  1: (doc) => ({ ...doc, version: 2, shots: [], music: null }),
}

export function parseProject(raw: unknown): Project {
  let doc = raw as any
  while (doc && typeof doc.version === 'number' && doc.version < PROJECT_VERSION) {
    const migrate = migrations[doc.version]
    if (!migrate) throw new Error(`No migration from project version ${doc.version}`)
    doc = migrate(doc)
  }
  return Project.parse(doc)
}
