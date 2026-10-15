import { existsSync } from 'node:fs'
import { chromium, type Browser, type Page } from 'playwright-core'
import type { MediaExtras } from './workspace'

export interface FramesRequest {
  times: number[]
  width: number
  columns?: number
  labels?: boolean
}

export interface ExportRequest {
  format: 'mp4' | 'webm' | 'png'
  scale: number
  fps: number
  quality: 'standard' | 'high' | 'max'
  motionBlur: number
  includeAudio: boolean
}

/**
 * Drives render.html in headless Chrome. One browser is reused; jobs run one at a time
 * so renders never fight over the GPU. The page talks back to this server over HTTP.
 */
export class Renderer {
  private browser: Promise<Browser> | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private readonly base: string

  constructor(base: string) {
    this.base = base
  }

  private launch(): Promise<Browser> {
    if (!this.browser) {
      const args = ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
      this.browser = (async () => {
        const explicit = process.env.UNICALI_CHROME
        if (explicit) return chromium.launch({ executablePath: explicit, headless: true, args })
        try {
          // Real Chrome ships the proprietary H.264 encoder that MP4 export needs.
          return await chromium.launch({ channel: 'chrome', headless: true, args })
        } catch {
          const bundled = chromium.executablePath()
          if (bundled && existsSync(bundled)) return chromium.launch({ headless: true, args })
          throw new Error('No Chrome found. Install Google Chrome, or set UNICALI_CHROME to a Chromium executable.')
        }
      })().catch((err) => {
        this.browser = null
        throw err
      })
    }
    return this.browser
  }

  private run<T>(job: (page: Page) => Promise<T>, timeoutMs: number): Promise<T> {
    const task = this.queue.then(async () => {
      const browser = await this.launch()
      const page = await browser.newPage()
      const logs: string[] = []
      page.on('console', (m) => m.type() === 'error' && logs.push(m.text()))
      page.on('pageerror', (e) => logs.push(e.message))
      try {
        page.setDefaultTimeout(timeoutMs)
        await page.goto(`${this.base}/render.html`)
        await page.waitForFunction(() => (window as any).unicaliRender?.ready === true)
        return await job(page)
      } catch (err) {
        const detail = logs.length ? `\nPage errors:\n${logs.slice(-5).join('\n')}` : ''
        throw new Error(`${(err as Error).message}${detail}`)
      } finally {
        await page.close().catch(() => {})
      }
    })
    this.queue = task.catch(() => {})
    return task
  }

  /** Returns PNG bytes of a contact sheet with one tile per requested time. */
  async frames(projectId: string, req: FramesRequest): Promise<Buffer> {
    const dataUrl = await this.run(
      (page) => page.evaluate(([id, r]) => (window as any).unicaliRender.frames(id, r), [projectId, req] as const),
      120_000,
    )
    return Buffer.from((dataUrl as string).split(',')[1], 'base64')
  }

  /** Renders a video in the page; the page PUTs the file to uploadUrl. */
  async export(projectId: string, req: ExportRequest, uploadUrl: string) {
    return this.run(
      (page) =>
        page.evaluate(([id, r, url]) => (window as any).unicaliRender.export(id, r, url), [projectId, req, uploadUrl] as const) as Promise<{
          filename: string; codec: string; frames: number; seconds: number; bytes: number
        }>,
      30 * 60_000,
    )
  }

  /** Palette (images/videos) or beat analysis (songs) for a stored asset, computed in Chrome. */
  async analyze(assetId: string, kind: 'image' | 'video' | 'audio') {
    return this.run(
      (page) => page.evaluate(([id, k]) => (window as any).unicaliRender.analyze(id, k), [assetId, kind] as const) as Promise<MediaExtras>,
      120_000,
    )
  }

  /** Review sheet of material (one labelled row per item; takes show several frames). PNG bytes. */
  async sheet(projectId: string, items: { assetId: string; label: string; times?: number[] }[], tileWidth?: number): Promise<Buffer> {
    const dataUrl = await this.run(
      (page) => page.evaluate(([id, it, w]) => (window as any).unicaliRender.sheet(id, it, w), [projectId, items, tileWidth] as const),
      180_000,
    )
    return Buffer.from((dataUrl as string).split(',')[1], 'base64')
  }

  async close() {
    const b = await this.browser?.catch(() => null)
    this.browser = null
    await b?.close().catch(() => {})
  }
}
