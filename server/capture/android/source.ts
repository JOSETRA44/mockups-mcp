import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Step } from '../../../src/core/capture/steps'
import { frameDifference, isBlankFrame } from '../../../src/core/capture/trim'
import { parseUiAutomator, targetPoint, type UiTree } from '../../../src/core/capture/uitree'
import { uid } from '../../../src/core/factory'
import { decodePng, thumbnail } from '../png'
import type { CaptureSession, CaptureSource, CaptureTarget, Look, OpenOptions } from '../types'
import { adb, adbSpawn, emulatorBinary, shell, sleep } from './adb'

const DEMO = 'am broadcast -a com.android.systemui.demo'
const KEYS = { enter: 66, search: 84, tab: 61, delete: 67, escape: 111 } as const

/**
 * Android capture over ADB: UIAutomator for semantics, screencap for lossless stills,
 * screenrecord (device-side H.264) for takes, SystemUI demo mode for a clean status bar.
 * Works with physical devices and emulators; nothing to install on the device.
 */
export class AndroidSource implements CaptureSource {
  readonly kind = 'android'

  async listTargets(): Promise<CaptureTarget[]> {
    const out: CaptureTarget[] = []
    const list = await adb(['devices', '-l']).catch(() => '')
    for (const line of list.split('\n').slice(1)) {
      const m = /^(\S+)\s+(device|unauthorized|offline)\b(.*)$/.exec(line.trim())
      if (!m) continue
      const model = /model:(\S+)/.exec(m[3])?.[1]?.replace(/_/g, ' ') ?? m[1]
      out.push({
        id: m[1],
        kind: 'android',
        name: m[1].startsWith('emulator-') ? `Emulator (${m[1]})` : model,
        state: m[2] === 'device' ? 'ready' : (m[2] as 'unauthorized' | 'offline'),
        details: { serial: m[1], model },
      })
    }
    const avds = await new Promise<string>((resolve) => {
      const p = spawn(emulatorBinary(), ['-list-avds'], { windowsHide: true })
      let s = ''
      p.stdout.on('data', (d) => (s += d))
      p.on('error', () => resolve(''))
      p.on('close', () => resolve(s))
    })
    for (const avd of avds.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
      out.push({ id: `avd:${avd}`, kind: 'android', name: avd.replace(/_/g, ' '), state: 'bootable', details: { avd } })
    }
    return out
  }

  async open(opts: OpenOptions): Promise<CaptureSession> {
    const targets = await this.listTargets()
    let target = opts.target ? targets.find((t) => t.id === opts.target || t.name === opts.target) : targets.find((t) => t.state === 'ready')
    if (!target) target = targets.find((t) => t.state === 'bootable')
    if (!target) throw new Error('No Android device or emulator found. Connect a phone with USB debugging, or create an AVD.')
    if (target.state === 'unauthorized') throw new Error(`${target.name}: authorise this computer on the phone (USB debugging prompt).`)
    const serial = target.state === 'bootable' ? await bootEmulator(target.details!.avd) : target.id
    const session = new AndroidSession(serial, target.name)
    await session.init(opts)
    return session
  }
}

async function bootEmulator(avd: string): Promise<string> {
  const before = new Set((await adb(['devices'])).split('\n').map((l) => l.split('\t')[0]))
  const p = spawn(emulatorBinary(), ['-avd', avd, '-no-snapshot-save', '-no-boot-anim', '-gpu', 'auto'], { detached: true, stdio: 'ignore', windowsHide: true })
  p.unref()
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    await sleep(2000)
    const serial = (await adb(['devices'])).split('\n').map((l) => l.split('\t')[0]).find((s) => s.startsWith('emulator-') && !before.has(s))
    if (serial && (await shell(serial, 'getprop sys.boot_completed').catch(() => '')).trim() === '1') return serial
  }
  throw new Error(`Emulator ${avd} did not boot within 3 minutes.`)
}

class AndroidSession implements CaptureSession {
  readonly id = `cap-${uid()}`
  readonly kind = 'android'
  readonly target: string
  readonly serial: string
  app: string | null = null
  size = { width: 1080, height: 2400 }
  private activity: string | null = null
  private demoBefore: string | null = null
  private recorder: ChildProcess | null = null
  private recordPath = ''
  private lastTree: UiTree | null = null

  constructor(serial: string, name: string) {
    this.serial = serial
    this.target = name
  }

  private sh(cmd: string, timeout?: number) {
    return shell(this.serial, cmd, timeout)
  }

  async init(opts: OpenOptions) {
    const size = /(\d+)x(\d+)/.exec(await this.sh('wm size'))
    if (size) this.size = { width: Number(size[1]), height: Number(size[2]) }
    await this.sh('input keyevent KEYCODE_WAKEUP')
    if (opts.install) await adb(['install', '-r', opts.install], { serial: this.serial, timeout: 300_000 })
    if (opts.clean !== false) await this.cleanOn()
    if (opts.app) {
      this.app = opts.app
      const resolved = (await this.sh(`cmd package resolve-activity --brief ${opts.app}`)).trim().split('\n').pop()?.trim()
      if (!resolved || !resolved.includes('/')) throw new Error(`App ${opts.app} is not installed on ${this.target}.`)
      this.activity = resolved
      await this.sh(`am start -W -n ${this.activity}`, 30_000)
      await this.waitForStill(6000)
    }
  }

  /** Clean status bar: fixed clock, full battery and signal, no notification or system icons. */
  /** The device's original setting survives crashes in a small state file, so it is always restored correctly. */
  private get stateFile() {
    return join(tmpdir(), `unicali-demo-${this.serial.replace(/[^\w.-]/g, '_')}.json`)
  }

  private async cleanOn() {
    const saved = existsSync(this.stateFile) ? JSON.parse(readFileSync(this.stateFile, 'utf8')).demoAllowed as string : null
    this.demoBefore = saved ?? (await this.sh('settings get global sysui_demo_allowed')).trim()
    writeFileSync(this.stateFile, JSON.stringify({ demoAllowed: this.demoBefore }))
    await this.sh('cmd statusbar collapse').catch(() => {})
    await this.sh('settings put global sysui_demo_allowed 1')
    await this.sh([
      `${DEMO} -e command enter`,
      `${DEMO} -e command clock -e hhmm 0941`,
      `${DEMO} -e command battery -e level 100 -e plugged false -e powersave false`,
      `${DEMO} -e command network -e wifi show -e level 4 -e fully true -e mobile hide -e airplane hide`,
      `${DEMO} -e command notifications -e visible false`,
      `${DEMO} -e command status -e alarm hide -e volume hide -e bluetooth hide -e location hide -e speakerphone hide -e mute hide -e zen hide -e eri hide -e tty hide -e sync hide`,
    ].join('; '))
  }

  private async cleanOff() {
    if (this.demoBefore === null) return
    await this.sh(`${DEMO} -e command exit`).catch(() => {})
    await this.sh(`settings put global sysui_demo_allowed ${this.demoBefore === 'null' ? 0 : this.demoBefore}`).catch(() => {})
    this.demoBefore = null
    rmSync(this.stateFile, { force: true })
  }

  async screenshot(): Promise<Buffer> {
    return adb(['exec-out', 'screencap', '-p'], { serial: this.serial, binary: true, timeout: 20_000 })
  }

  async uiTree(): Promise<UiTree> {
    // uiautomator waits for the UI to be idle; retry once if an animation was running.
    for (let i = 0; i < 2; i++) {
      const xml = await adb(['exec-out', 'uiautomator', 'dump', '/dev/tty'], { serial: this.serial, timeout: 20_000 }).catch(() => '')
      const start = xml.indexOf('<?xml')
      const end = xml.lastIndexOf('</hierarchy>')
      if (start >= 0 && end > start) return (this.lastTree = parseUiAutomator(xml.slice(start, end + 12)))
      await sleep(400)
    }
    return (this.lastTree = { width: this.size.width, height: this.size.height, package: '', elements: [] })
  }

  async look(opts: { tree?: boolean } = {}): Promise<Look> {
    const png = await this.screenshot()
    const tree = opts.tree === false ? { width: this.size.width, height: this.size.height, package: '', elements: [] } : await this.uiTree()
    const img = decodePng(png)
    const focus = await this.sh('dumpsys window | grep -m1 mCurrentFocus').catch(() => '')
    const app = /u0 ([\w.]+)\//.exec(focus)?.[1] ?? tree.package
    // Ignore the status bar: it stays visible even over protected windows.
    return { png, tree, app, blank: isBlankFrame(img.data, Math.round(img.height * 0.05), img.width) }
  }

  private async point(target: Parameters<typeof targetPoint>[1], tree?: UiTree): Promise<[number, number]> {
    if ('at' in target) return [Math.round(target.at[0] * this.size.width), Math.round(target.at[1] * this.size.height)]
    const t = tree ?? this.lastTree ?? (await this.uiTree())
    let p = targetPoint(t, target)
    // Screens arrive late (splash, network, transitions): wait for the target to appear.
    const deadline = Date.now() + 6000
    while (!p && Date.now() < deadline) {
      await sleep(400)
      p = targetPoint(await this.uiTree(), target)
    }
    if (!p) throw new Error(`Could not find ${JSON.stringify(target)} on screen after 6 s. Use capture_look to see the current elements.`)
    return p
  }

  async act(step: Step, tree?: UiTree): Promise<void> {
    const { width: W, height: H } = this.size
    if ('tap' in step) {
      const [x, y] = await this.point(step.tap, tree)
      await this.sh(`input tap ${x} ${y}`)
      await sleep(step.after)
    } else if ('longPress' in step) {
      const [x, y] = await this.point(step.longPress, tree)
      await this.sh(`input swipe ${x} ${y} ${x} ${y} ${step.duration}`)
      await sleep(step.after)
    } else if ('type' in step) {
      if (step.into) {
        const [x, y] = await this.point(step.into, tree)
        await this.sh(`input tap ${x} ${y}`)
        await sleep(350)
      }
      // One shell call types character by character: an on-camera typing rhythm without adb round trips.
      const chars = [...step.type].map((c) => (c === ' ' ? '%s' : c.replace(/(["'\\$`&|;<>()*?!#~])/g, '\\$1')))
      const pause = (step.perChar / 1000).toFixed(3)
      await this.sh(chars.map((c) => `input text ${c}`).join(`; sleep ${pause}; `), 120_000)
      await sleep(step.after)
    } else if ('scroll' in step) {
      const area = step.within ? await this.areaOf(step.within, tree) : [0, Math.round(H * 0.15), W, Math.round(H * 0.85)]
      const cx = Math.round((area[0] + area[2]) / 2), cy = Math.round((area[1] + area[3]) / 2)
      const dy = Math.round(((area[3] - area[1]) * step.amount) / 2), dx = Math.round(((area[2] - area[0]) * step.amount) / 2)
      const ms = { slow: 1100, normal: 500, fling: 180 }[step.speed]
      const [x1, y1, x2, y2] =
        step.scroll === 'down' ? [cx, cy + dy, cx, cy - dy]
        : step.scroll === 'up' ? [cx, cy - dy, cx, cy + dy]
        : step.scroll === 'right' ? [cx + dx, cy, cx - dx, cy]
        : [cx - dx, cy, cx + dx, cy]
      await this.sh(`input swipe ${x1} ${y1} ${x2} ${y2} ${ms}`)
      await sleep(step.after)
    } else if ('swipe' in step) {
      const { from, to, duration } = step.swipe
      await this.sh(`input swipe ${Math.round(from[0] * W)} ${Math.round(from[1] * H)} ${Math.round(to[0] * W)} ${Math.round(to[1] * H)} ${duration}`)
      await sleep(step.after)
    } else if ('wait' in step) {
      await sleep(step.wait)
    } else if ('waitFor' in step) {
      const deadline = Date.now() + step.timeout
      while (Date.now() < deadline) {
        if (targetPoint(await this.uiTree(), step.waitFor)) return
        await sleep(300)
      }
      throw new Error(`Timed out waiting for ${JSON.stringify(step.waitFor)}.`)
    } else if ('back' in step) {
      await this.sh('input keyevent 4')
      await sleep(step.after)
    } else if ('key' in step) {
      await this.sh(`input keyevent ${KEYS[step.key]}`)
      await sleep(step.after)
    } else if ('launch' in step) {
      if (step.launch && step.launch !== this.app) {
        this.app = step.launch
        this.activity = null
      }
      await this.relaunch()
      await sleep(step.after)
    }
    this.lastTree = null
  }

  private async areaOf(target: Parameters<typeof targetPoint>[1], tree?: UiTree): Promise<[number, number, number, number]> {
    if (!('at' in target)) {
      const t = tree ?? (await this.uiTree())
      const { findElement } = await import('../../../src/core/capture/uitree')
      const e = findElement(t, target)
      if (e) return e.bounds
    }
    const [x, y] = await this.point(target, tree)
    return [x - 200, y - 400, x + 200, y + 400]
  }

  async relaunch() {
    if (!this.app) throw new Error('No app in this session.')
    if (!this.activity) this.activity = (await this.sh(`cmd package resolve-activity --brief ${this.app}`)).trim().split('\n').pop()!.trim()
    // -S restarts the process (state from scratch) without touching the app's data.
    await this.sh(`am start -S -W -n ${this.activity}`, 30_000)
    await this.waitForStill(8000)
  }

  async waitForStill(timeoutMs = 5000): Promise<number> {
    const t0 = Date.now()
    let prev = thumbnail(decodePng(await this.screenshot()))
    while (Date.now() - t0 < timeoutMs) {
      await sleep(250)
      const cur = thumbnail(decodePng(await this.screenshot()))
      if (frameDifference(prev.data, cur.data) < 0.004) return Date.now() - t0
      prev = cur
    }
    return Date.now() - t0
  }

  async startRecording() {
    if (this.recorder) throw new Error('Already recording.')
    this.recordPath = `/sdcard/unicali-take-${Date.now()}.mp4`
    // Device-side hardware H.264 at native size; frames are timestamped on the device.
    this.recorder = adbSpawn(this.serial, ['shell', 'screenrecord', '--bit-rate', '16000000', this.recordPath])
    let err = ''
    this.recorder.stderr?.on('data', (d) => (err += d))
    await sleep(900) // encoder warm-up: the first frames arrive after ~0.5 s
    if (this.recorder.exitCode !== null) {
      this.recorder = null
      throw new Error(`screenrecord failed to start: ${err.trim() || 'unknown error'}`)
    }
  }

  async stopRecording(): Promise<string> {
    const rec = this.recorder
    if (!rec) throw new Error('Not recording.')
    this.recorder = null
    // SIGINT lets screenrecord finalise the MP4 (moov atom) instead of truncating it.
    await this.sh('pkill -2 screenrecord').catch(() => {})
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { rec.kill(); resolve() }, 8000)
      rec.on('close', () => { clearTimeout(timer); resolve() })
    })
    await sleep(500)
    const local = join(mkdtempSync(join(tmpdir(), 'unicali-take-')), 'take.mp4')
    await adb(['pull', this.recordPath, local], { serial: this.serial, timeout: 120_000 })
    await this.sh(`rm -f ${this.recordPath}`).catch(() => {})
    return local
  }

  async close() {
    if (this.recorder) await this.stopRecording().catch(() => {})
    await this.cleanOff()
  }
}
