import { z } from 'zod'

/**
 * Declarative interaction steps. A take is "setup steps (not recorded) → recorded steps",
 * stored with the resulting asset so material can be re-shot later (another locale, dark
 * mode, a new build). Steps are source-agnostic: Android today, web/desktop/iOS later.
 */
export const TargetSchema = z.union([
  z.object({ ref: z.string().describe('Element ref from the latest look, e.g. "e7"') }).strict(),
  z.object({ text: z.string().describe('Visible text (accent/case-insensitive)') }).strict(),
  z.object({ desc: z.string().describe('Accessibility label') }).strict(),
  z.object({ id: z.string().describe('Resource id') }).strict(),
  z.object({ at: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).describe('Normalised point [x, y], 0..1 from top-left') }).strict(),
])

const ms = (d: number) => z.number().int().min(0).max(30_000).default(d)

export const StepSchema = z.union([
  z.object({ tap: TargetSchema, after: ms(700).describe('Settle time after the tap (ms)') }).strict(),
  z.object({ longPress: TargetSchema, duration: ms(700), after: ms(700) }).strict(),
  z.object({
    type: z.string().max(500),
    into: TargetSchema.optional().describe('Field to focus first'),
    perChar: ms(70).describe('Delay between characters, for an on-camera typing feel'),
    after: ms(500),
  }).strict(),
  z.object({
    scroll: z.enum(['down', 'up', 'left', 'right']),
    amount: z.number().min(0.05).max(1).default(0.45).describe('Fraction of the screen to move'),
    speed: z.enum(['slow', 'normal', 'fling']).default('normal').describe('slow = readable glide, fling = momentum'),
    within: TargetSchema.optional().describe('Scrollable area (default: screen centre)'),
    after: ms(600),
  }).strict(),
  z.object({
    swipe: z.object({
      from: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
      to: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
      duration: z.number().int().min(50).max(5000).default(400),
    }).strict(),
    after: ms(600),
  }).strict(),
  z.object({ wait: z.number().int().min(0).max(30_000).describe('Pause (ms) — lets the viewer read') }).strict(),
  z.object({ waitFor: TargetSchema, timeout: ms(8000) }).strict(),
  z.object({ back: z.literal(true), after: ms(700) }).strict(),
  z.object({ key: z.enum(['enter', 'search', 'tab', 'delete', 'escape']), after: ms(400) }).strict(),
  z.object({ launch: z.string().optional().describe('Package to (re)launch; default: the session app'), after: ms(1500) }).strict(),
])

export type Step = z.infer<typeof StepSchema>
export type StepTarget = z.infer<typeof TargetSchema>

export const TakeSchema = z.object({
  label: z.string().min(1).max(80).describe('What this take shows, e.g. "Grades overview scroll"'),
  setup: z.array(StepSchema).max(40).default([]).describe('Steps run before recording (navigate to the start state)'),
  steps: z.array(StepSchema).min(1).max(40).describe('Steps performed on camera'),
  leadIn: z.number().int().min(0).max(5000).default(700).describe('Still time recorded before the first step (ms)'),
  hold: z.number().int().min(0).max(8000).default(1200).describe('Still time recorded after the last step (ms)'),
}).strict()

export type Take = z.infer<typeof TakeSchema>
