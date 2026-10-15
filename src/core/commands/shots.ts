import { z } from 'zod'
import { evaluateChannels } from '../animation/evaluate'
import { musicGrid } from '../music/sync'
import { layoutShots, SHOT_DEFAULTS, shotsEnd } from '../shots/shots'
import { EaseId, ShotKind, ShotMove, type Keyframe, type Project, type Shot } from '../schema/project'
import { CommandError, defineCommand, edit, findDevice, type CommandContext } from './types'

const Region = z.object({
  x: z.number().min(0).max(1).describe('Centre, 0 = left edge of the screen'),
  y: z.number().min(0).max(1).describe('Centre, 0 = top of the screen'),
  size: z.number().min(0.05).max(1.5).describe('Height as a fraction of the screen height'),
  w: z.number().min(0.05).max(1.5).optional().describe('Width as a fraction of the screen width (default = size; ~0.95 for full-width UI)'),
}).strict()

/** Optional fields shared by create/update: anything omitted falls back to the kind defaults. */
const ShotFields = {
  deviceId: z.string().nullable().optional(),
  region: Region.optional().describe('What to frame (focus shots)'),
  yaw: z.number().min(-180).max(180).optional().describe('View angle around the device, degrees (0 = front, - = from the left)'),
  pitch: z.number().min(-80).max(80).optional().describe('Degrees, + = from above'),
  fill: z.number().min(0.1).max(1.5).optional().describe('Device height as a fraction of the frame (hero/angle/wide/orbit)'),
  move: ShotMove.optional().describe('Motion during the shot: hold, push (closer), pull (back), drift (slow sideways), orbit'),
  moveAmount: z.number().min(0).max(1).optional(),
  transition: z.number().min(0).max(4).optional().describe('Seconds the camera takes to arrive; 0 = cut'),
  ease: EaseId.optional().describe('Feel of the arrival (product = signature, easeInOut = smooth, spring = playful)'),
  media: z.object({
    assetId: z.string(),
    from: z.number().min(0).optional().describe('Seconds into the video where the shot starts (default: the take\'s trimmed start)'),
    speed: z.number().min(0.25).max(4).default(1),
    fitTake: z.boolean().optional().describe('Retime the take so its useful part fits the shot (0.75×–1.6×); recommended for takes'),
  }).strict().nullable().optional().describe('What the screen shows during this shot (a screenshot or a take); null = the device\'s default screen'),
}

const ShotInput = z.object({
  kind: ShotKind.describe('hero (whole device, front), focus (a screen region), angle (3/4 beauty view), wide (small, lots of space), orbit (camera circles)'),
  duration: z.number().min(0.2).max(60).describe('Seconds'),
  ...ShotFields,
}).strict()

type ShotInputT = z.infer<typeof ShotInput>

/** Callers pass media already resolved (see resolveMedia): `from` is filled in. */
function makeShot(input: Omit<ShotInputT, 'media'> & { media?: Shot['media'] }, ctx: CommandContext): Shot {
  const d = SHOT_DEFAULTS[input.kind]
  return {
    id: ctx.newId(),
    start: 0,
    duration: input.duration,
    kind: input.kind,
    deviceId: input.deviceId ?? null,
    region: input.region ?? d.region,
    yaw: input.yaw ?? d.yaw,
    pitch: input.pitch ?? d.pitch,
    fill: input.fill ?? d.fill,
    move: input.move ?? d.move,
    moveAmount: input.moveAmount ?? d.moveAmount,
    transition: input.transition ?? d.transition,
    ease: input.ease ?? d.ease,
    ...(input.media !== undefined ? { media: input.media } : {}),
  }
}

function commit(p: Project, shots: Shot[]) {
  return edit(p, (d) => {
    d.shots = layoutShots(shots)
    const end = shotsEnd(d.shots)
    if (end > d.settings.duration || d.shots.length) d.settings.duration = +Math.max(0.5, end).toFixed(3)
  }).project
}

const checkDevice = (p: Project, id?: string | null) => { if (id) findDevice(p, id) }

type MediaInput = { assetId: string; from?: number; speed?: number; fitTake?: boolean } | null | undefined

/** Validates a shot's media and fills `from` with the take's trimmed start. */
function resolveMedia(p: Project, m: MediaInput): Shot['media'] | undefined {
  if (m === undefined) return undefined
  if (m === null) return null
  const asset = p.assets[m.assetId]
  if (!asset) throw new CommandError('NOT_FOUND', `No asset "${m.assetId}". Assets: ${Object.keys(p.assets).join(', ') || 'none'}`)
  if (asset.kind === 'audio') throw new CommandError('INVALID_ARGS', `"${asset.name}" is audio; shot media must be an image or video.`)
  return { assetId: m.assetId, from: m.from ?? asset.trim?.in ?? 0, speed: m.speed ?? 1, ...(m.fitTake ? { fitTake: true } : {}) }
}

export const setShots = defineCommand({
  name: 'set_shots',
  summary: 'Set the camera story as a list of shots',
  description:
    'Replaces the camera story with shots played in order (each starts when the previous ends; the scene length becomes their total). ' +
    'A shot describes WHAT is seen: "focus" frames a region of the screen (pick it from the screenshot, UV from top-left), the others frame the device. ' +
    'The camera arrives at each shot\'s start (transition plays before it). Fields you omit use good defaults per kind. ' +
    'Typical: angle (2 s) → focus top (2 s) → focus bottom (2 s) → hero (2 s). Then fit_to_music if there is a song.',
  args: z.object({ shots: z.array(ShotInput).min(1).max(40) }),
  run: (p, a, ctx) => {
    a.shots.forEach((s) => checkDevice(p, s.deviceId))
    const shots = a.shots.map((s) => makeShot({ ...s, media: resolveMedia(p, s.media) }, ctx))
    return { project: commit(p, shots), result: { shotIds: shots.map((s) => s.id) } }
  },
})

export const addShot = defineCommand({
  name: 'add_shot',
  summary: 'Insert one shot into the camera story',
  description: 'Inserts at `index` (default: end) or at the shot under `time`. Later shots move right.',
  args: z.object({
    kind: ShotKind,
    duration: z.number().min(0.2).max(60).default(2),
    index: z.number().int().min(0).optional(),
    time: z.number().min(0).optional().describe('Insert after the shot playing at this time'),
    ...ShotFields,
  }),
  run: (p, a, ctx) => {
    checkDevice(p, a.deviceId)
    const { index, time, ...input } = a
    const shot = makeShot({ ...input, media: resolveMedia(p, input.media) }, ctx)
    let at = index ?? p.shots.length
    if (time !== undefined && index === undefined) {
      const k = p.shots.findIndex((s) => time >= s.start && time < s.start + s.duration)
      at = k < 0 ? p.shots.length : k + 1
    }
    const shots = [...p.shots]
    shots.splice(Math.min(at, shots.length), 0, shot)
    return { project: commit(p, shots), result: { shotId: shot.id } }
  },
})

export const updateShot = defineCommand({
  name: 'update_shot',
  summary: 'Change a shot (framing, angle, move, transition, length)',
  description:
    'Changing duration uses a "roll" edit by default: the next shot absorbs the difference so everything after stays in place (ripple=true pushes later shots instead). ' +
    'Changing kind keeps your region/duration and resets the rest to that kind\'s defaults unless also given.',
  args: z.object({
    shotId: z.string(),
    kind: ShotKind.optional(),
    duration: z.number().min(0.2).max(60).optional(),
    ripple: z.boolean().default(false),
    ...ShotFields,
  }),
  run: (p, a) => {
    const i = p.shots.findIndex((s) => s.id === a.shotId)
    if (i < 0) throw new CommandError('NOT_FOUND', `No shot "${a.shotId}". Shots: ${p.shots.map((s) => s.id).join(', ') || 'none'}`)
    checkDevice(p, a.deviceId)
    const shots = p.shots.map((s) => ({ ...s }))
    const s = shots[i]
    if (a.kind && a.kind !== s.kind) Object.assign(s, { ...SHOT_DEFAULTS[a.kind], region: s.region, kind: a.kind })
    for (const k of ['deviceId', 'region', 'yaw', 'pitch', 'fill', 'move', 'moveAmount', 'transition', 'ease'] as const) {
      if (a[k] !== undefined) (s as Record<string, unknown>)[k] = a[k]
    }
    if (a.media !== undefined) s.media = resolveMedia(p, a.media)
    if (a.duration !== undefined && a.duration !== s.duration) {
      const delta = a.duration - s.duration
      const next = shots[i + 1]
      if (!a.ripple && next) {
        if (next.duration - delta < 0.2) throw new CommandError('INVALID_ARGS', `The next shot would become shorter than 0.2 s (max duration here: ${(s.duration + next.duration - 0.2).toFixed(2)} s). Use ripple=true.`)
        next.duration -= delta
      }
      s.duration = a.duration
    }
    return { project: commit(p, shots) }
  },
})

export const removeShot = defineCommand({
  name: 'remove_shot',
  summary: 'Remove a shot (or all shots)',
  description: 'Later shots move left. all=true clears the camera story (the camera returns to its rest pose / keyframes).',
  args: z.object({ shotId: z.string().optional(), all: z.boolean().default(false) }),
  run: (p, a) => {
    if (a.all) return edit(p, (d) => { d.shots = [] })
    if (!a.shotId || !p.shots.some((s) => s.id === a.shotId)) throw new CommandError('NOT_FOUND', `No shot "${a.shotId}".`)
    const rest = p.shots.filter((s) => s.id !== a.shotId)
    return { project: rest.length ? commit(p, rest) : edit(p, (d) => { d.shots = [] }).project }
  },
})

export const moveShot = defineCommand({
  name: 'move_shot',
  summary: 'Reorder a shot in the story',
  description: 'Moves the shot to a new position; starts are recomputed.',
  args: z.object({ shotId: z.string(), index: z.number().int().min(0) }),
  run: (p, a) => {
    const i = p.shots.findIndex((s) => s.id === a.shotId)
    if (i < 0) throw new CommandError('NOT_FOUND', `No shot "${a.shotId}".`)
    const shots = [...p.shots]
    const [s] = shots.splice(i, 1)
    shots.splice(Math.min(a.index, shots.length), 0, s)
    return { project: commit(p, shots) }
  },
})

export const createStoryboard = defineCommand({
  name: 'create_storyboard',
  summary: 'Build a ready-to-tweak camera story in one step',
  description:
    'Creates an intro angle, focus shots on the UI blocks detected in the screenshot (cards, buttons, top to bottom; spread evenly when none were detected), and a hero ending. ' +
    'With music, each shot lasts `barsPerShot` bars so changes land on the music; otherwise `secondsPerShot`. ' +
    'Pass `regions` to aim the focus shots at specific UI (recommended: look at the screenshot first). ' +
    'Pass `assetIds` (captured screenshots/takes, in story order) to build the story from material: one shot per asset showing it, ' +
    'focusing a screenshot\'s main UI block or playing a take from its trimmed start.',
  args: z.object({
    assetIds: z.array(z.string()).max(12).optional().describe('Material in story order: each becomes a shot that shows it'),
    focusCount: z.number().int().min(0).max(8).optional().describe('Number of focus shots (default: detected UI blocks, else 3)'),
    regions: z.array(Region).max(8).optional(),
    barsPerShot: z.number().int().min(1).max(16).default(2),
    secondsPerShot: z.number().min(0.5).max(10).default(2),
    deviceId: z.string().optional(),
  }),
  run: (p, a, ctx) => {
    checkDevice(p, a.deviceId)
    const grid = musicGrid(p)
    const shotLen = grid ? (a.barsPerShot * 4 * 60) / grid.bpm : a.secondsPerShot
    // Aim at real UI when the screenshot was analysed on import; otherwise spread evenly.
    const dev = findDevice(p, a.deviceId)
    const detected = dev.screen.assetId ? p.assets[dev.screen.assetId]?.regions ?? [] : []
    const count = a.regions?.length ?? a.focusCount ?? (detected.length || 3)
    const regions = a.regions ?? (detected.length
      ? detected.slice(0, count)
      : Array.from({ length: count }, (_, i) => ({ x: 0.5, y: +((i + 0.5) / count * 0.9 + 0.05).toFixed(3), size: 0.38, w: 0.95 })))
    const material = (a.assetIds ?? []).map((id) => {
      const asset = p.assets[id]
      if (!asset) throw new CommandError('NOT_FOUND', `No asset "${id}".`)
      if (asset.kind === 'audio') throw new CommandError('INVALID_ARGS', `"${asset.name}" is audio, not screen material.`)
      return asset
    })
    const inputs: (Omit<ShotInputT, 'media'> & { media?: Shot['media'] })[] = material.length
      ? [
          // Open wide on the first piece of material, then one readable shot per asset, end on the hero.
          { kind: 'angle', duration: shotLen, deviceId: a.deviceId, media: resolveMedia(p, { assetId: material[0].id }) },
          ...material.map((asset): Omit<ShotInputT, 'media'> & { media?: Shot['media'] } => {
            const isTake = asset.kind === 'video'
            // A take reads best almost full-screen; a still focuses its most prominent block.
            // Size 1.05 keeps the whole screen in a portrait frame (a take must read in full).
            const region = isTake || !asset.regions?.length ? { x: 0.5, y: 0.5, size: 1.05, w: 1 } : asset.regions[0]
            const takeLen = isTake ? Math.max(0.5, (asset.trim?.out ?? asset.duration ?? shotLen) - (asset.trim?.in ?? 0)) : shotLen
            return {
              kind: 'focus', region, deviceId: a.deviceId, move: isTake ? 'hold' : 'drift',
              duration: isTake ? Math.max(shotLen, Math.min(takeLen, shotLen * 2)) : shotLen,
              media: resolveMedia(p, { assetId: asset.id, fitTake: isTake }),
            }
          }),
          { kind: 'hero', duration: shotLen, deviceId: a.deviceId, media: resolveMedia(p, { assetId: material[material.length - 1].id }) },
        ]
      : [
          { kind: 'angle', duration: shotLen, deviceId: a.deviceId },
          ...regions.map((region) => ({ kind: 'focus' as const, duration: shotLen, region, deviceId: a.deviceId })),
          { kind: 'hero', duration: shotLen, deviceId: a.deviceId },
        ]
    const shots = inputs.map((s) => makeShot(s, ctx))
    return { project: commit(p, shots), result: { shotIds: shots.map((s) => s.id), secondsPerShot: +shotLen.toFixed(3) } }
  },
})

const CAMERA_CHANNELS = ['yaw', 'pitch', 'distance', 'fov', 'target.x', 'target.y', 'target.z']

export const bakeShots = defineCommand({
  name: 'bake_shots',
  summary: 'Convert the shots into camera keyframes (advanced)',
  description: 'Samples the camera story at the project fps into keyframe tracks and removes the shots. Use for hand-editing curves; undo to go back.',
  args: z.object({}),
  run: (p, _a, ctx) => {
    if (!p.shots.length) throw new CommandError('CONFLICT', 'There are no shots to bake.')
    const fps = p.settings.fps
    const end = shotsEnd(p.shots)
    const keys: Record<string, Keyframe[]> = Object.fromEntries(CAMERA_CHANNELS.map((c) => [c, []]))
    const noTracks = { ...p, tracks: p.tracks.filter((t) => !t.path.startsWith('camera.')) }
    for (let i = 0; i <= Math.ceil(end * fps); i++) {
      const t = Math.min(end, i / fps)
      const ch = evaluateChannels(noTracks, t)
      for (const c of CAMERA_CHANNELS) keys[c].push({ t, value: ch[`camera.${c}`], ease: 'linear' })
    }
    return edit(p, (d) => {
      d.tracks = d.tracks.filter((t) => !t.path.startsWith('camera.'))
      for (const c of CAMERA_CHANNELS) d.tracks.push({ id: ctx.newId(), path: `camera.${c}`, keyframes: keys[c] })
      d.shots = []
    })
  },
})
