import { describe, expect, it } from 'vitest'
import { evaluateChannels } from '../animation/evaluate'
import { createProject } from '../factory'
import { parseProject } from '../schema/project'
import { catalog, COMMANDS, commandSchemas, CommandError, describeProject, runBatch, runCommand, sampleScene, TEMPLATES } from './index'

const fresh = () => {
  const p = createProject('test')
  return { ...p, clips: [], tracks: [] }
}

describe('commands', () => {
  it('rejects unknown commands and bad args with readable errors', () => {
    const p = fresh()
    expect(() => runCommand(p, 'nope', {})).toThrow(/Unknown command/)
    expect(() => runCommand(p, 'set_background', { color: 'red' })).toThrow(/#RRGGBB/)
    expect(() => runCommand(p, 'add_motion', { preset: 'tilt', params: { angleX: 999 } })).toThrow(/\[-45, 45\]/)
    try {
      runCommand(p, 'set_screen', { assetId: 'missing' })
    } catch (e) {
      expect(e).toBeInstanceOf(CommandError)
      expect((e as CommandError).code).toBe('NOT_FOUND')
    }
  })

  it('never mutates the input project', () => {
    const p = fresh()
    const snapshot = JSON.stringify(p)
    runCommand(p, 'set_camera', { yaw: 40 })
    runCommand(p, 'add_motion', { preset: 'hero-reveal' })
    expect(JSON.stringify(p)).toBe(snapshot)
  })

  it('add_motion targets the camera for camera presets and returns the clip id', () => {
    const { project, result } = runCommand(fresh(), 'add_motion', { preset: 'push-in', start: 1 })
    expect(project.clips[0].target).toBe('camera')
    expect(result?.clipId).toBe(project.clips[0].id)
  })

  it('set_channel_value auto-keys when a track exists', () => {
    let p = fresh()
    p = runCommand(p, 'set_channel_value', { path: 'camera.yaw', value: 10 }).project
    expect(p.tracks).toHaveLength(0)
    expect(p.nodes.find((n) => n.type === 'camera')!.type === 'camera' && (p.nodes.find((n) => n.type === 'camera') as any).yaw).toBe(10)
    p = runCommand(p, 'set_keyframe', { path: 'camera.yaw', time: 0, value: 0 }).project
    p = runCommand(p, 'set_channel_value', { path: 'camera.yaw', value: 30, time: 2 }).project
    expect(p.tracks[0].keyframes.map((k) => k.value)).toEqual([0, 30])
    expect(evaluateChannels(p, 2)['camera.yaw']).toBeCloseTo(30)
  })

  it('set_camera_path writes camera tracks that pass through the waypoints', () => {
    const { project } = runCommand(fresh(), 'set_camera_path', {
      waypoints: [
        { time: 0, yaw: -30, distance: 9 },
        { time: 2, focus: { x: 0.5, y: 0.2, size: 0.4 } },
        { time: 4, yaw: 20 },
      ],
    })
    const at = (t: number) => evaluateChannels(project, t)
    expect(at(0)['camera.yaw']).toBeCloseTo(-30)
    expect(at(0)['camera.distance']).toBeCloseTo(9)
    expect(at(2)['camera.distance']).toBeLessThan(4) // zoomed onto the region
    expect(at(2)['camera.target.y']).toBeGreaterThan(0.3) // top of the screen
    expect(at(4)['camera.yaw']).toBeCloseTo(20)
    expect(at(4)['camera.distance']).toBeCloseTo(at(2)['camera.distance']) // carried over
  })

  it('every template applies cleanly and yields a valid project', () => {
    for (const t of TEMPLATES) {
      const { project } = runCommand(createProject(), 'apply_template', { template: t.id })
      expect(() => parseProject(JSON.parse(JSON.stringify(project)))).not.toThrow()
      expect(project.settings.duration).toBeGreaterThanOrEqual(t.duration)
      for (const v of Object.values(evaluateChannels(project, t.duration / 2))) expect(Number.isFinite(v)).toBe(true)
    }
  })

  it('batch is atomic', () => {
    const p = fresh()
    expect(() => runBatch(p, [{ command: 'set_camera', args: { yaw: 5 } }, { command: 'remove_motion', args: { clipId: 'x' } }])).not.toThrow()
    expect(() => runBatch(p, [{ command: 'set_camera', args: { yaw: 5 } }, { command: 'bake_motion', args: { clipId: 'x' } }])).toThrow(/Step 2/)
  })

  it('remove_device refuses to delete the last device and cleans up clips', () => {
    let p = fresh()
    const first = p.nodes[0].id
    expect(() => runCommand(p, 'remove_device', { deviceId: first })).toThrow(/at least one/)
    const added = runCommand(p, 'add_device', { model: 'phone-android', position: [1.3, 0, 0] })
    p = runCommand(added.project, 'add_motion', { preset: 'tilt', target: added.result!.deviceId as string }).project
    p = runCommand(p, 'remove_device', { deviceId: added.result!.deviceId as string }).project
    expect(p.clips).toHaveLength(0)
  })

  it('queries and schemas are JSON-serialisable', () => {
    const p = runCommand(createProject(), 'apply_template', { template: 'app-launch' }).project
    expect(JSON.parse(JSON.stringify(describeProject(p))).motions.length).toBe(3)
    expect(sampleScene(p, [0, 1])).toHaveLength(2)
    expect(catalog().presets.length).toBeGreaterThan(5)
    expect(commandSchemas()).toHaveLength(COMMANDS.length)
  })
})
