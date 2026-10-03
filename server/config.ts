import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repository root (server/ lives one level below it). */
export const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const VERSION = '0.2.0'

export interface ServerConfig {
  host: string
  port: number
  /** Where projects, assets and renders are stored. */
  home: string
  /** Serve the editor through Vite (HMR, always fresh) instead of the built dist/. */
  dev: boolean
}

export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    // Loopback only: the API can read/write local files, so it must never be exposed.
    host: '127.0.0.1',
    port: Number(process.env.UNICALI_PORT ?? 5299),
    home: resolve(process.env.UNICALI_HOME ?? join(homedir(), 'UnicaliMockups')),
    dev: process.env.UNICALI_DEV === '1',
    // Ignore explicit `undefined`s so optional CLI flags fall back to the defaults.
    ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined)),
  }
}

export const baseUrl = (c: Pick<ServerConfig, 'host' | 'port'>) => `http://${c.host}:${c.port}`
