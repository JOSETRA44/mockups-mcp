import {
  AddEquation, CanvasTexture, Color, CustomBlending, DirectionalLight, FramebufferTexture,
  HalfFloatType, Mesh, NeutralToneMapping, OneFactor, OrthographicCamera, PerspectiveCamera,
  PlaneGeometry, PMREMGenerator, Scene, ShaderMaterial, SRGBColorSpace, Vector2, WebGLRenderer,
  WebGLRenderTarget, type Texture,
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import type { ResolvedScene } from '@/core/animation/channels'
import { deg2rad } from '@/core/math'
import { getDevice } from '@/core/devices/registry'
import type { Background, Lighting } from '@/core/schema/project'
import { buildProceduralPhone, type DeviceObject } from './devices/proceduralPhone'
import type { SourceProvider } from './sources/types'

export interface EngineOptions {
  canvas: HTMLCanvasElement | OffscreenCanvas
  width: number
  height: number
  pixelRatio?: number
  /** Needed when frames are read back from the canvas (export). */
  preserveDrawingBuffer?: boolean
}

const LIGHT_PRESETS: Record<Lighting['preset'], { env: number; key: number; rim: number; fill: number; keyPos: [number, number, number]; rimColor: string }> = {
  studio: { env: 1, key: 2.2, rim: 1.6, fill: 0.5, keyPos: [-3, 4, 5], rimColor: '#ffffff' },
  soft: { env: 1.35, key: 1.0, rim: 0.6, fill: 0.6, keyPos: [-2, 3, 6], rimColor: '#fff6ee' },
  dramatic: { env: 0.35, key: 3.2, rim: 3.5, fill: 0.1, keyPos: [-5, 2, 2], rimColor: '#9ec5ff' },
}

/** Raw copy shader: no tone mapping or colour conversion (values are already display-encoded). */
const copyMaterial = (opacity: number) =>
  new ShaderMaterial({
    uniforms: { tex: { value: null }, opacity: { value: opacity } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform sampler2D tex; uniform float opacity; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tex, vUv) * opacity; }',
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })

/**
 * Imperative three.js renderer that draws a ResolvedScene. It holds no notion of time
 * or presets — the same class powers the editor viewport and the offline exporter.
 */
export class Engine {
  readonly renderer: WebGLRenderer
  readonly scene = new Scene()
  readonly camera = new PerspectiveCamera(30, 9 / 16, 0.01, 200)
  private devices = new Map<string, { deviceId: string; finishId: string; obj: DeviceObject }>()
  private sources: SourceProvider | null = null
  private key = new DirectionalLight('#ffffff', 2)
  private rim = new DirectionalLight('#ffffff', 1.5)
  private fill = new DirectionalLight('#ffffff', 0.5)
  private bgKey = ''
  private bgTexture: Texture | null = null
  private width: number
  private height: number

  constructor(opts: EngineOptions) {
    this.width = opts.width
    this.height = opts.height
    this.renderer = new WebGLRenderer({
      canvas: opts.canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false,
      powerPreference: 'high-performance',
    })
    this.renderer.outputColorSpace = SRGBColorSpace
    // Khronos PBR Neutral keeps base colours faithful while still rolling off highlights.
    this.renderer.toneMapping = NeutralToneMapping
    this.renderer.setPixelRatio(opts.pixelRatio ?? 1)
    this.renderer.setSize(opts.width, opts.height, false)

    const pmrem = new PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()

    this.rim.position.set(4, 3, -4)
    this.fill.position.set(4, -1, 4)
    this.scene.add(this.key, this.rim, this.fill)
  }

  setSources(provider: SourceProvider) {
    this.sources = provider
  }

  setSize(width: number, height: number, pixelRatio = this.renderer.getPixelRatio()) {
    this.width = width
    this.height = height
    this.renderer.setPixelRatio(pixelRatio)
    this.renderer.setSize(width, height, false)
  }

  /** Brings the three.js graph in line with the resolved values. */
  private sync(r: ResolvedScene) {
    this.syncBackground(r.background)
    this.syncLighting(r.lighting)

    const seen = new Set<string>()
    for (const d of r.devices) {
      seen.add(d.id)
      let entry = this.devices.get(d.id)
      if (!entry || entry.deviceId !== d.deviceId) {
        if (entry) this.removeDevice(d.id)
        const obj = buildProceduralPhone(getDevice(d.deviceId))
        entry = { deviceId: d.deviceId, finishId: '', obj }
        this.devices.set(d.id, entry)
        this.scene.add(obj.group)
      }
      if (entry.finishId !== d.finishId) {
        const spec = getDevice(d.deviceId)
        entry.obj.setFinish(spec.finishes.find((f) => f.id === d.finishId) ?? spec.finishes[0])
        entry.finishId = d.finishId
      }
      const g = entry.obj.group
      g.position.set(...d.position)
      g.rotation.set(deg2rad(d.rotation[0]), deg2rad(d.rotation[1]), deg2rad(d.rotation[2]), 'XYZ')
      g.scale.setScalar(Math.max(0.001, d.scale))

      const src = d.screen.assetId ? this.sources?.get(d.screen.assetId) ?? null : null
      entry.obj.screen.setContent(src?.texture ?? null, src?.width ?? 0, src?.height ?? 0, d.screen.fit)
      entry.obj.screen.setView(d.screen.zoom, d.screen.panX, d.screen.panY)
    }
    for (const id of [...this.devices.keys()]) if (!seen.has(id)) this.removeDevice(id)

    this.camera.fov = r.camera.fov
    this.camera.aspect = this.width / this.height
    this.camera.position.set(...r.camera.position)
    this.camera.lookAt(...r.camera.target)
    this.camera.updateProjectionMatrix()
  }

  /** Lets every screen source catch up to time t (awaitable for frame-exact export). */
  prepareSources(r: ResolvedScene, playing: boolean): Promise<unknown> {
    const jobs: (void | Promise<void>)[] = []
    for (const d of r.devices) {
      if (!d.screen.assetId) continue
      const src = this.sources?.get(d.screen.assetId)
      // Media time is resolved in core (per-shot media, trims, loops); sources just seek.
      if (src) jobs.push(src.prepare(d.screen.mediaTime, playing))
    }
    return Promise.all(jobs)
  }

  render(r: ResolvedScene) {
    this.sync(r)
    this.renderer.setRenderTarget(null)
    this.renderer.render(this.scene, this.camera)
  }

  // ---- Motion blur by sub-frame accumulation (export only) -------------------------
  private accum: { rt: WebGLRenderTarget; fb: FramebufferTexture; quad: Mesh; addMat: ShaderMaterial; outMat: ShaderMaterial; cam: OrthographicCamera; scene: Scene } | null = null

  private ensureAccum() {
    const size = this.renderer.getDrawingBufferSize(new Vector2())
    if (this.accum && this.accum.rt.width === size.x && this.accum.rt.height === size.y) return this.accum
    this.accum?.rt.dispose()
    this.accum?.fb.dispose()
    const rt = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, depthBuffer: false })
    const fb = new FramebufferTexture(size.x, size.y)
    const addMat = copyMaterial(1)
    addMat.blending = CustomBlending
    addMat.blendEquation = AddEquation
    addMat.blendSrc = OneFactor
    addMat.blendDst = OneFactor
    addMat.transparent = true
    const outMat = copyMaterial(1)
    const quad = new Mesh(new PlaneGeometry(2, 2), addMat)
    const scene = new Scene()
    scene.add(quad)
    this.accum = { rt, fb, quad, addMat, outMat, cam: new OrthographicCamera(-1, 1, 1, -1, 0, 1), scene }
    return this.accum
  }

  /** Renders several sub-frame states and averages them into the canvas. */
  renderAccumulated(frames: ResolvedScene[]) {
    if (frames.length <= 1) return this.render(frames[0])
    const a = this.ensureAccum()
    const r = this.renderer
    const prevAutoClear = r.autoClear
    r.setRenderTarget(a.rt)
    r.setClearColor(0x000000, 0)
    r.clear()
    for (const f of frames) {
      this.render(f) // full pipeline to the canvas (tone mapping + sRGB)
      r.copyFramebufferToTexture(a.fb)
      a.quad.material = a.addMat
      a.addMat.uniforms.tex.value = a.fb
      a.addMat.uniforms.opacity.value = 1 / frames.length
      r.setRenderTarget(a.rt)
      r.autoClear = false
      r.render(a.scene, a.cam)
      r.autoClear = prevAutoClear
    }
    r.setRenderTarget(null)
    a.quad.material = a.outMat
    a.outMat.uniforms.tex.value = a.rt.texture
    r.setClearColor(0x000000, 0)
    r.clear()
    r.render(a.scene, a.cam)
  }

  // ---- Background & lighting ------------------------------------------------------
  private syncBackground(bg: Background) {
    const aspect = this.width / this.height
    const key = `${bg.kind}|${bg.color}|${bg.color2}|${bg.angle}|${aspect.toFixed(3)}`
    if (key === this.bgKey) return
    this.bgKey = key
    this.bgTexture?.dispose()
    this.bgTexture = null
    if (bg.kind === 'transparent') {
      this.scene.background = null
      this.renderer.setClearColor(0x000000, 0)
    } else if (bg.kind === 'solid') {
      this.scene.background = new Color(bg.color)
    } else {
      this.bgTexture = gradientTexture(bg, aspect)
      this.scene.background = this.bgTexture
    }
  }

  private syncLighting(l: Lighting) {
    const p = LIGHT_PRESETS[l.preset] ?? LIGHT_PRESETS.studio
    this.scene.environmentIntensity = p.env * l.environment
    this.key.intensity = p.key * l.intensity
    this.key.position.set(...p.keyPos)
    this.rim.intensity = p.rim * l.intensity
    this.rim.color.set(p.rimColor)
    this.fill.intensity = p.fill * l.intensity
  }

  private removeDevice(id: string) {
    const e = this.devices.get(id)
    if (!e) return
    this.scene.remove(e.obj.group)
    e.obj.dispose()
    this.devices.delete(id)
  }

  dispose() {
    for (const id of [...this.devices.keys()]) this.removeDevice(id)
    this.bgTexture?.dispose()
    this.accum?.rt.dispose()
    this.accum?.fb.dispose()
    this.scene.environment?.dispose()
    this.renderer.dispose()
  }
}

/** CSS-style linear gradient (angle 180 = top → bottom) with dithering against banding. */
function gradientTexture(bg: Background, aspect: number): Texture {
  const h = 512
  const w = Math.max(1, Math.round(h * aspect))
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  const a = deg2rad(bg.angle)
  const dx = Math.sin(a), dy = -Math.cos(a)
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2
  const g = ctx.createLinearGradient(w / 2 - dx * half, h / 2 - dy * half, w / 2 + dx * half, h / 2 + dy * half)
  g.addColorStop(0, bg.color)
  g.addColorStop(1, bg.color2)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  const img = ctx.getImageData(0, 0, w, h)
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 2.5
    img.data[i] += n
    img.data[i + 1] += n
    img.data[i + 2] += n
  }
  ctx.putImageData(img, 0, 0)
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  return tex
}
