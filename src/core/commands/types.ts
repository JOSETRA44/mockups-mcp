import { produce } from 'immer'
import type { z } from 'zod'
import { uid } from '../factory'
import { getDevice } from '../devices/registry'
import type { CameraNode, DeviceNode, Project } from '../schema/project'
import type { DevicePose } from '../camera/framing'

/**
 * Commands are the single write API of Unicali. The editor UI, the MCP server, the CLI
 * and the HTTP API all execute these same pure functions, so a capability added here
 * is instantly available to humans and agents alike.
 */
export interface CommandContext {
  newId: () => string
}

export interface CommandOutput {
  project: Project
  /** Small JSON payload for the caller (e.g. the id of a created clip). */
  result?: Record<string, unknown>
}

export interface Command<S extends z.ZodType = z.ZodType> {
  name: string
  /** One line, imperative ("Add a motion preset clip"). Used in tool lists. */
  summary: string
  /** Longer guidance for agents: semantics, units, gotchas. */
  description: string
  args: S
  run(project: Project, args: z.infer<S>, ctx: CommandContext): CommandOutput
}

export const defineCommand = <S extends z.ZodType>(c: Command<S>): Command<S> => c

export class CommandError extends Error {
  readonly code: 'NOT_FOUND' | 'INVALID_ARGS' | 'UNKNOWN_COMMAND' | 'CONFLICT'
  constructor(code: CommandError['code'], message: string) {
    super(message)
    this.code = code
    this.name = 'CommandError'
  }
}

export const defaultContext: CommandContext = { newId: uid }

/** Immutable edit helper: runs `recipe` on a draft, bumps updatedAt, returns the recipe's value. */
export function edit<R = void>(project: Project, recipe: (draft: Project) => R): { project: Project; value: R } {
  let value!: R
  const next = produce(project, (d) => {
    value = recipe(d as Project)
    d.updatedAt = Date.now()
  })
  return { project: next, value }
}

export function findDevice(project: Project, id?: string): DeviceNode {
  const devices = project.nodes.filter((n): n is DeviceNode => n.type === 'device')
  const dev = id ? devices.find((d) => d.id === id) : devices[0]
  if (!dev) throw new CommandError('NOT_FOUND', id ? `No device with id "${id}". Devices: ${devices.map((d) => d.id).join(', ') || 'none'}` : 'The project has no device.')
  return dev
}

export function findCamera(project: Project): CameraNode {
  const cam = project.nodes.find((n): n is CameraNode => n.type === 'camera')
  if (!cam) throw new CommandError('NOT_FOUND', 'The project has no camera.')
  return cam
}

export const devicePose = (d: DeviceNode): DevicePose => ({
  position: d.transform.position,
  rotation: d.transform.rotation,
  scale: d.transform.scale,
  spec: getDevice(d.deviceId),
})

export const aspectOf = (p: Project) => p.settings.width / p.settings.height
