import type { Step } from '../../src/core/capture/steps'
import type { UiTree } from '../../src/core/capture/uitree'

/**
 * Capture sources produce material (stills and takes) from a running app. The editor never
 * sees a source: it only receives ordinary image/video assets with `source` metadata. New
 * sources (web, desktop, iOS) implement these two interfaces and plug into the registry.
 */
export interface CaptureTarget {
  id: string
  kind: string
  name: string
  /** ready = connected and usable; bootable = can be started (e.g. an emulator image). */
  state: 'ready' | 'bootable' | 'unauthorized' | 'offline'
  details?: Record<string, string>
}

export interface Look {
  png: Buffer
  tree: UiTree
  /** The foreground app/package (or page) when the look was taken. */
  app: string
  /** True when the frame is black: a protected window (FLAG_SECURE) or the screen is off. */
  blank: boolean
}

/** A finished recording; `window` marks the take inside a longer file (sources that record continuously). */
export interface Recording {
  path: string
  window?: { in: number; out: number }
}

export interface OpenOptions {
  target?: string
  /** Package / bundle / URL to show. */
  app?: string
  /** Optional installable build (APK) to install first. */
  install?: string
  /** Clean presentation (status bar demo mode, no notifications). Default true. */
  clean?: boolean
}

export interface CaptureSession {
  readonly id: string
  readonly kind: string
  readonly target: string
  readonly app: string | null
  readonly size: { width: number; height: number }
  look(opts?: { tree?: boolean }): Promise<Look>
  /** Performs one step. Targets resolve against `tree` when given (no extra UI dump). */
  act(step: Step, tree?: UiTree): Promise<void>
  /** Starts the app from a fresh launch (process restarted, not data cleared). */
  relaunch(): Promise<void>
  startRecording(): Promise<void>
  /** Stops and returns the recorded video. */
  stopRecording(): Promise<Recording>
  /** Waits until two consecutive frames match (UI settled). Returns the elapsed ms. */
  waitForStill(timeoutMs?: number): Promise<number>
  close(): Promise<void>
}

export interface CaptureSource {
  readonly kind: string
  listTargets(): Promise<CaptureTarget[]>
  open(opts: OpenOptions): Promise<CaptureSession>
}
