import { z } from 'zod'
import type { Project } from '../schema/project'
import {
  addMotion, bakeMotion, removeKeyframes, removeMotion, setCameraPath, setChannelValue, setKeyframe, updateMotion,
} from './motion'
import {
  addDevice, frameDeviceCmd, removeDevice, renameProject, setBackground, setCamera, setDevice, setFormat, setLighting,
  setScreen,
} from './scene'
import { applyTemplate } from './templates'
import { addShot, bakeShots, createStoryboard, moveShot, removeShot, setShots, updateShot } from './shots'
import { fitToMusicCmd, removeMusic, setMusic, setTempo } from './music'
import { applyLook } from './looks'
import { CommandError, defaultContext, type Command, type CommandContext, type CommandOutput } from './types'

export * from './types'
export { TEMPLATES } from './templates'
export { describeProject, sampleScene, catalog } from './queries'
export { addAssetToProject } from './assets'

/** Every write operation, in the order they are documented. */
export const COMMANDS: Command[] = [
  renameProject,
  setFormat,
  setBackground,
  setLighting,
  addDevice,
  removeDevice,
  setDevice,
  setScreen,
  setCamera,
  frameDeviceCmd,
  addMotion,
  updateMotion,
  removeMotion,
  bakeMotion,
  setKeyframe,
  removeKeyframes,
  setChannelValue,
  setCameraPath,
  setShots,
  addShot,
  updateShot,
  removeShot,
  moveShot,
  createStoryboard,
  bakeShots,
  setMusic,
  removeMusic,
  setTempo,
  fitToMusicCmd,
  applyLook,
  applyTemplate,
] as Command[]

const byName = new Map(COMMANDS.map((c) => [c.name, c]))
export const getCommand = (name: string) => byName.get(name)

/** Validates args and runs a command. Throws CommandError with an agent-readable message. */
export function runCommand(project: Project, name: string, rawArgs: unknown, ctx: CommandContext = defaultContext): CommandOutput {
  const cmd = byName.get(name)
  if (!cmd) throw new CommandError('UNKNOWN_COMMAND', `Unknown command "${name}". Available: ${COMMANDS.map((c) => c.name).join(', ')}`)
  // Strict at the top level: a misspelled argument must fail loudly, not be silently ignored.
  const schema = cmd.args instanceof z.ZodObject ? cmd.args.strict() : cmd.args
  const parsed = schema.safeParse(rawArgs ?? {})
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(args)'}: ${i.message}`).join('; ')
    throw new CommandError('INVALID_ARGS', `${name}: ${issues}`)
  }
  return cmd.run(project, parsed.data, ctx)
}

/** Runs several commands in order as one atomic change (all or nothing). */
export function runBatch(project: Project, steps: { command: string; args?: unknown }[], ctx: CommandContext = defaultContext) {
  const results: (Record<string, unknown> | undefined)[] = []
  let p = project
  steps.forEach((s, i) => {
    try {
      const out = runCommand(p, s.command, s.args, ctx)
      p = out.project
      results.push(out.result)
    } catch (err) {
      if (err instanceof CommandError) throw new CommandError(err.code, `Step ${i + 1} (${s.command}) failed: ${err.message}`)
      throw err
    }
  })
  return { project: p, results }
}

/** JSON Schema of every command — handy for docs generation and non-MCP agents. */
export function commandSchemas() {
  return COMMANDS.map((c) => ({ name: c.name, summary: c.summary, description: c.description, args: z.toJSONSchema(c.args, { io: 'input' }) }))
}
