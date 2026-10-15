import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright-core'
import type { Step } from '../../../src/core/capture/steps'
import { frameDifference, isBlankFrame } from '../../../src/core/capture/trim'
import { targetPoint, type Target, type UiElement, type UiTree } from '../../../src/core/capture/uitree'
import { uid } from '../../../src/core/factory'
import { sleep } from '../android/adb'
import { decodePng, thumbnail } from '../png'
import type { CaptureSession, CaptureSource, CaptureTarget, Look, OpenOptions, Recording } from '../types'

/** Phone-sized viewport (CSS px) at 3× density → 1170×2532 captures, like a modern phone. */
const VIEWPORT = { width: 390, height: 844 }
const DPR = 3

/** Turns captured frames (JPEG + capture time, variable frame rate) into a video file. */
export type FrameEncoder = (frames: { jpeg: string; t: number }[], size: { width: number; height: number }) => Promise<string>

/**
 * Web pages and web apps as material, through headless Chrome at a phone viewport. Same
 * session contract as Android: semantic elements, paced steps, clean stills, recorded takes.
 * Takes use Chrome's screencast (frames only on change, like Android's recorder) and are
 * encoded by the server's renderer, so no extra binary (ffmpeg) is needed.
 */
export class WebSource implements CaptureSource {
  readonly kind = 'web'
  private browser: Promise<Browser> | null = null
  private readonly encode: FrameEncoder

  constructor(encode: FrameEncoder) {
    this.encode = encode
  }

  async listTargets(): Promise<CaptureTarget[]> {
    return [{ id: 'web:phone', kind: 'web', name: 'Web page (phone viewport)', state: 'ready', details: { viewport: `${VIEWPORT.width}x${VIEWPORT.height}@${DPR}x` } }]
  }

  private launch() {
    this.browser ??= chromium
      .launch({ channel: process.env.UNICALI_CHROME ? undefined : 'chrome', executablePath: process.env.UNICALI_CHROME, headless: true })
      .catch(() => chromium.launch({ headless: true }))
    return this.browser
  }

  async open(opts: OpenOptions): Promise<CaptureSession> {
    if (!opts.app) throw new Error('A web capture needs a URL (app).')
    const session = new WebSession(await this.launch(), opts.app, this.encode)
    await session.start()
    return session
  }
}

class WebSession implements CaptureSession {
  readonly id = `cap-${uid()}`
  readonly kind = 'web'
  readonly target = 'Web page (phone viewport)'
  readonly app: string
  readonly size = { width: VIEWPORT.width * DPR, height: VIEWPORT.height * DPR }
  private context!: BrowserContext
  private page!: Page
  private cdp: CDPSession | null = null
  private frames: { jpeg: string; t: number }[] = []
  private readonly browser: Browser
  private readonly encode: FrameEncoder

  constructor(browser: Browser, url: string, encode: FrameEncoder) {
    this.browser = browser
    this.app = url
    this.encode = encode
  }

  async start() {
    this.context = await this.browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DPR, isMobile: true, hasTouch: true })
    this.page = await this.context.newPage()
    await this.relaunch()
  }

  async look(opts: { tree?: boolean } = {}): Promise<Look> {
    const png = await this.page.screenshot({ type: 'png' })
    const img = decodePng(png)
    const tree = opts.tree === false ? { width: this.size.width, height: this.size.height, package: this.app, elements: [] } : await this.uiTree()
    return { png, tree, app: this.page.url(), blank: isBlankFrame(img.data) }
  }

  /** Visible, meaningful DOM elements (text, labels, controls) in device pixels. */
  private async uiTree(): Promise<UiTree> {
    const raw = await this.page.evaluate(() => {
      const out: { tag: string; text: string; desc: string; id: string; b: number[]; click: boolean; scroll: boolean; edit: boolean }[] = []
      // Real apps keep most text in plain div/span: include any element with its own text,
      // plus interactive and labelled ones. Interactive elements report their full text.
      // (No named functions in here: the bundler's __name helper does not exist in the page.)
      document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
        const tag = el.tagName.toLowerCase()
        if (/^(script|style|noscript|svg|path|template)$/.test(tag)) return
        const r = el.getBoundingClientRect()
        if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > innerHeight) return
        const st = getComputedStyle(el)
        if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) return
        const click = /^(a|button|select|summary)$/.test(tag) || el.hasAttribute('onclick') || ['button', 'link', 'tab', 'menuitem', 'checkbox'].includes(el.getAttribute('role') ?? '') || st.cursor === 'pointer'
        const edit = /^(input|textarea)$/.test(tag) || el.isContentEditable
        const desc = el.getAttribute('aria-label') ?? (tag === 'img' ? (el as HTMLImageElement).alt : '') ?? ''
        const raw = click
          ? el.innerText ?? ''
          : Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join(' ')
        const text = raw.trim().replace(/\s+/g, ' ').slice(0, 120)
        if (!text && !desc && !click && !edit) return
        // A clickable child of a clickable parent (e.g. a span inside a button) adds nothing.
        if (!click && el.parentElement?.closest('a,button,[role=button],[onclick]')) return
        out.push({ tag, text, desc, id: el.id, b: [r.left, r.top, r.right, r.bottom], click, scroll: el.scrollHeight > el.clientHeight + 8 && /auto|scroll/.test(st.overflowY), edit })
      })
      return out
    })
    const elements: UiElement[] = raw.map((e, i) => ({
      ref: `e${i + 1}`,
      role: e.edit ? 'input' : e.click ? 'button' : /^h\d$/.test(e.tag) ? 'heading' : e.tag === 'img' ? 'image' : 'text',
      text: e.text,
      desc: e.desc,
      id: e.id,
      bounds: e.b.map((v) => Math.round(v * DPR)) as UiElement['bounds'],
      clickable: e.click,
      scrollable: e.scroll,
      editable: e.edit,
      focused: false,
    }))
    return { width: this.size.width, height: this.size.height, package: this.app, elements }
  }

  /** CSS-pixel point for a target, waiting for it to appear. */
  private async css(target: Target, tree?: UiTree): Promise<[number, number]> {
    if ('at' in target) return [target.at[0] * VIEWPORT.width, target.at[1] * VIEWPORT.height]
    const deadline = Date.now() + 6000
    let p = targetPoint(tree ?? (await this.uiTree()), target)
    while (!p && Date.now() < deadline) {
      await sleep(300)
      p = targetPoint(await this.uiTree(), target)
    }
    if (!p) throw new Error(`Could not find ${JSON.stringify(target)} on the page.`)
    return [p[0] / DPR, p[1] / DPR]
  }

  async act(step: Step, tree?: UiTree): Promise<void> {
    const m = this.page.mouse
    if ('tap' in step) {
      const [x, y] = await this.css(step.tap, tree)
      await this.page.touchscreen.tap(x, y)
      await sleep(step.after)
    } else if ('longPress' in step) {
      const [x, y] = await this.css(step.longPress, tree)
      await m.move(x, y)
      await m.down()
      await sleep(step.duration)
      await m.up()
      await sleep(step.after)
    } else if ('type' in step) {
      if (step.into) {
        const [x, y] = await this.css(step.into, tree)
        await this.page.touchscreen.tap(x, y)
      }
      await this.page.keyboard.type(step.type, { delay: step.perChar })
      await sleep(step.after)
    } else if ('scroll' in step) {
      // Smooth on-camera scroll: many small wheel steps instead of one jump.
      const sign = step.scroll === 'down' || step.scroll === 'right' ? 1 : -1
      const horizontal = step.scroll === 'left' || step.scroll === 'right'
      const dist = sign * step.amount * (horizontal ? VIEWPORT.width : VIEWPORT.height)
      const steps = { slow: 40, normal: 20, fling: 6 }[step.speed]
      await m.move(VIEWPORT.width / 2, VIEWPORT.height / 2)
      for (let i = 0; i < steps; i++) {
        await m.wheel(horizontal ? dist / steps : 0, horizontal ? 0 : dist / steps)
        await sleep(16)
      }
      await sleep(step.after)
    } else if ('swipe' in step) {
      const { from, to, duration } = step.swipe
      await m.move(from[0] * VIEWPORT.width, from[1] * VIEWPORT.height)
      await m.down()
      await m.move(to[0] * VIEWPORT.width, to[1] * VIEWPORT.height, { steps: Math.max(2, Math.round(duration / 16)) })
      await m.up()
      await sleep(step.after)
    } else if ('wait' in step) {
      await sleep(step.wait)
    } else if ('waitFor' in step) {
      await this.css(step.waitFor)
    } else if ('back' in step) {
      await this.page.goBack().catch(() => {})
      await sleep(step.after)
    } else if ('key' in step) {
      await this.page.keyboard.press({ enter: 'Enter', search: 'Enter', tab: 'Tab', delete: 'Backspace', escape: 'Escape' }[step.key])
      await sleep(step.after)
    } else if ('launch' in step) {
      await this.relaunch()
      await sleep(step.after)
    }
  }

  async relaunch() {
    await this.page.goto(this.app, { waitUntil: 'networkidle' }).catch(() => this.page.goto(this.app))
  }

  async waitForStill(timeoutMs = 5000) {
    const t0 = Date.now()
    let prev = thumbnail(decodePng(await this.page.screenshot({ type: 'png' })))
    while (Date.now() - t0 < timeoutMs) {
      await sleep(200)
      const cur = thumbnail(decodePng(await this.page.screenshot({ type: 'png' })))
      if (frameDifference(prev.data, cur.data) < 0.004) return Date.now() - t0
      prev = cur
    }
    return Date.now() - t0
  }

  async startRecording() {
    if (this.cdp) throw new Error('Already recording.')
    this.frames = []
    const cdp = await this.context.newCDPSession(this.page)
    this.cdp = cdp
    cdp.on('Page.screencastFrame', (f: { data: string; metadata: { timestamp?: number }; sessionId: number }) => {
      this.frames.push({ jpeg: f.data, t: f.metadata.timestamp ?? Date.now() / 1000 })
      void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
    })
    // The screencast only emits on change: grab the opening frame explicitly.
    const first = await this.page.screenshot({ type: 'jpeg', quality: 92 })
    this.frames.push({ jpeg: first.toString('base64'), t: Date.now() / 1000 })
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: this.size.width, maxHeight: this.size.height, everyNthFrame: 1 })
  }

  async stopRecording(): Promise<Recording> {
    const cdp = this.cdp
    if (!cdp) throw new Error('Not recording.')
    this.cdp = null
    await cdp.send('Page.stopScreencast').catch(() => {})
    await cdp.detach().catch(() => {})
    // End on a frame of the final state so the take ends on its result.
    const last = await this.page.screenshot({ type: 'jpeg', quality: 92 })
    const frames = [...this.frames, { jpeg: last.toString('base64'), t: Date.now() / 1000 }].sort((a, b) => a.t - b.t)
    return { path: await this.encode(frames, this.size) }
  }

  async close() {
    await this.cdp?.detach().catch(() => {})
    await this.context?.close().catch(() => {})
  }
}
