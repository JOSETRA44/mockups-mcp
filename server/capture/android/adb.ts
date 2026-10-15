import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Locates the Android SDK tools: env vars, the standard per-user SDK, then PATH. */
function sdkRoots() {
  const roots = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT]
  if (process.platform === 'win32') roots.push(join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Android', 'Sdk'))
  else if (process.platform === 'darwin') roots.push(join(homedir(), 'Library', 'Android', 'sdk'))
  else roots.push(join(homedir(), 'Android', 'Sdk'))
  return roots.filter((r): r is string => !!r && existsSync(r))
}

const exe = (name: string) => (process.platform === 'win32' ? `${name}.exe` : name)

export function findTool(sub: 'platform-tools' | 'emulator', name: string): string {
  for (const root of sdkRoots()) {
    const p = join(root, sub, exe(name))
    if (existsSync(p)) return p
  }
  return name // rely on PATH
}

export interface ExecOptions {
  serial?: string
  timeout?: number
  binary?: boolean
}

export function adb(args: string[], opts: ExecOptions & { binary: true }): Promise<Buffer>
export function adb(args: string[], opts?: ExecOptions): Promise<string>
export function adb(args: string[], opts: ExecOptions = {}): Promise<string | Buffer> {
  const full = opts.serial ? ['-s', opts.serial, ...args] : args
  return new Promise((resolve, reject) => {
    execFile(findTool('platform-tools', 'adb'), full, {
      encoding: opts.binary ? 'buffer' : 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: opts.timeout ?? 30_000,
      windowsHide: true,
    }, (err, stdout, stderr) => {
      if (err) reject(new Error(`adb ${args.join(' ')}: ${String(stderr || err.message).trim()}`))
      else resolve(stdout as string | Buffer)
    })
  })
}

export const shell = (serial: string, command: string, timeout?: number) => adb(['shell', command], { serial, timeout })

/** A long-running adb process (e.g. screenrecord). */
export function adbSpawn(serial: string, args: string[]): ChildProcess {
  return spawn(findTool('platform-tools', 'adb'), ['-s', serial, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
}

export function emulatorBinary() {
  return findTool('emulator', 'emulator')
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
