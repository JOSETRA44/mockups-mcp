import { z } from 'zod'
import type { Project } from '../schema/project'
import { addMotion, setCameraPath } from './motion'
import { setFormat } from './scene'
import { defineCommand, edit, findDevice, type CommandContext } from './types'

/**
 * A template is a recipe of commands. Because it is built from commands (not raw JSON)
 * it stays valid as presets evolve, and agents can read templates as worked examples.
 */
export interface Template {
  id: string
  name: string
  description: string
  duration: number
  apply(p: Project, deviceId: string, ctx: CommandContext): Project
}

const run = <A>(p: Project, cmd: { run: (p: Project, a: A, c: CommandContext) => { project: Project } }, args: unknown, ctx: CommandContext) =>
  cmd.run(p, (cmd as unknown as { args: z.ZodType<A> }).args.parse(args), ctx).project

export const TEMPLATES: Template[] = [
  {
    id: 'app-launch',
    name: 'App Launch',
    description: 'Hero reveal from below, gentle floating, slow push-in. The classic store-ad opener.',
    duration: 6,
    apply: (p, target, ctx) => {
      p = run(p, addMotion, { preset: 'hero-reveal', target, start: 0, duration: 2.2 }, ctx)
      p = run(p, addMotion, { preset: 'floating', target, start: 2.2, duration: 3.8 }, ctx)
      return run(p, addMotion, { preset: 'push-in', start: 1.6, duration: 4.4, params: { amount: 0.22, ease: 'easeInOut' } }, ctx)
    },
  },
  {
    id: 'feature-zoom',
    name: 'Feature Zoom',
    description: 'Side entrance, then the camera dives into a feature on screen and returns.',
    duration: 6,
    apply: (p, target, ctx) => {
      p = run(p, addMotion, { preset: 'side-entrance', target, start: 0, duration: 1.8 }, ctx)
      return run(p, addMotion, { preset: 'screen-focus', start: 2, duration: 3.6, params: { focusY: 0.3, size: 0.45 } }, ctx)
    },
  },
  {
    id: 'orbit-showcase',
    name: 'Orbit Showcase',
    description: 'A full hero spin while the camera arcs around — shows the hardware from every angle.',
    duration: 6,
    apply: (p, target, ctx) => {
      p = run(p, addMotion, { preset: 'hero-spin', target, start: 0.3, duration: 2.6 }, ctx)
      p = run(p, addMotion, { preset: 'camera-orbit', start: 0, duration: 6, params: { angle: 70 } }, ctx)
      return run(p, addMotion, { preset: 'floating', target, start: 2.9, duration: 3.1 }, ctx)
    },
  },
  {
    id: 'camera-journey',
    name: 'Camera Journey',
    description: 'A keyframed camera path: wide three-quarter view → top of the screen → bottom → hero.',
    duration: 7,
    apply: (p, _target, ctx) =>
      run(p, setCameraPath, {
        waypoints: [
          { time: 0, yaw: -35, pitch: 12 },
          { time: 2, focus: { x: 0.5, y: 0.22, size: 0.45 } },
          { time: 4.2, focus: { x: 0.5, y: 0.75, size: 0.45 } },
          { time: 7, yaw: 0, pitch: 0, focus: { x: 0.5, y: 0.5, size: 1.6, face: 0 } },
        ],
      }, ctx),
  },
]

export const applyTemplate = defineCommand({
  name: 'apply_template',
  summary: 'Replace the animation with a ready-made template',
  description: `Templates: ${TEMPLATES.map((t) => `${t.id} (${t.description})`).join('; ')}. Clears existing motions and keyframes unless keepExisting=true. Sets the duration to the template length.`,
  args: z.object({
    template: z.enum(TEMPLATES.map((t) => t.id) as [string, ...string[]]),
    deviceId: z.string().optional(),
    keepExisting: z.boolean().default(false),
  }),
  run: (p, a, ctx) => {
    const tpl = TEMPLATES.find((t) => t.id === a.template)!
    const target = findDevice(p, a.deviceId).id
    let next = a.keepExisting ? p : edit(p, (d) => { d.clips = []; d.tracks = [] }).project
    next = run(next, setFormat, { duration: tpl.duration, reframe: false }, ctx)
    next = tpl.apply(next, target, ctx)
    return { project: next, result: { template: tpl.id, clips: next.clips.length } }
  },
})
