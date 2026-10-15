import { type Step, type Take } from '../../src/core/capture/steps'
import { targetPoint, type Target, type UiTree } from '../../src/core/capture/uitree'
import { sleep } from './android/adb'
import type { CaptureSession } from './types'

export interface TakeResult {
  videoPath: string
  /** Steps as performed on camera, with targets resolved to normalised points. */
  performed: Step[]
  log: string[]
}

/**
 * Shoots one deliberate take, the way a director would:
 *  1. reset: fresh app launch, then the setup steps (not recorded)
 *  2. rehearsal: perform the on-camera steps once, resolving every target to a point and
 *     measuring how long each screen needs to settle (semantic lookups are slow; they must
 *     never appear on camera as dead time)
 *  3. reset again, then record: lead-in, the steps at rehearsed timing, a held ending
 */
export async function shootTake(session: CaptureSession, take: Take): Promise<TakeResult> {
  const log: string[] = []
  const toStart = async () => {
    await session.relaunch()
    for (const s of take.setup) await session.act(s)
    await session.waitForStill(6000)
  }

  await toStart()
  log.push('rehearsal')
  const performed: Step[] = []
  for (const step of take.steps) {
    const tree: UiTree | undefined = needsTree(step) ? (await session.look()).tree : undefined
    const resolved = resolveStep(step, tree, session.size)
    await session.act(resolved)
    // Measure the settle time after state-changing steps; keep the director's minimum.
    const settle = changesScreen(step) ? await session.waitForStill(4000) : 0
    performed.push(withAfter(resolved, Math.max(afterOf(resolved), settle + 250)))
  }

  await toStart()
  log.push('recording')
  await session.startRecording()
  let failure: unknown = null
  try {
    await sleep(take.leadIn)
    for (const step of performed) await session.act(step)
    await sleep(take.hold)
  } catch (err) {
    failure = err
  }
  // Always stop: an abandoned screenrecord keeps running on the device.
  const videoPath = await session.stopRecording()
  if (failure) throw failure
  return { videoPath, performed, log }
}

const needsTree = (s: Step) =>
  ('tap' in s && !('at' in s.tap)) || ('longPress' in s && !('at' in s.longPress)) || ('type' in s && !!s.into && !('at' in s.into))

const changesScreen = (s: Step) => 'tap' in s || 'back' in s || 'key' in s || 'launch' in s || 'longPress' in s

const afterOf = (s: Step) => ('after' in s && typeof s.after === 'number' ? s.after : 0)

function withAfter(s: Step, after: number): Step {
  return 'after' in s ? ({ ...s, after } as Step) : s
}

/** Replaces semantic targets with normalised points so the recorded pass needs no UI dumps. */
function resolveStep(step: Step, tree: UiTree | undefined, size: { width: number; height: number }): Step {
  if (!tree) return step
  const toAt = (t: Target): Target => {
    if ('at' in t) return t
    const e = targetPoint(tree, t)
    if (!e) throw new Error(`Rehearsal: could not find ${JSON.stringify(t)} on screen.`)
    return { at: [+(e[0] / size.width).toFixed(4), +(e[1] / size.height).toFixed(4)] as [number, number] }
  }
  if ('tap' in step) return { ...step, tap: toAt(step.tap) }
  if ('longPress' in step) return { ...step, longPress: toAt(step.longPress) }
  if ('type' in step && step.into) return { ...step, into: toAt(step.into) }
  return step
}
