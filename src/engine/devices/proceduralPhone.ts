import {
  AdditiveBlending, BoxGeometry, Color, CylinderGeometry, ExtrudeGeometry, Group, Mesh,
  MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, PlaneGeometry, Shape, ShapeGeometry,
  type Material,
} from 'three'
import { screenSurfaceZ, type DeviceFinish, type DeviceSpec } from '@/core/devices/registry'
import { ScreenMaterial } from '../screen/ScreenMaterial'

export interface DeviceObject {
  group: Group
  screen: ScreenMaterial
  setFinish(finish: DeviceFinish): void
  dispose(): void
}

function roundedRect(w: number, h: number, r: number): Shape {
  const s = new Shape()
  const x = -w / 2, y = -h / 2
  r = Math.min(r, w / 2, h / 2)
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + h - r)
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  s.lineTo(x + r, y + h)
  s.quadraticCurveTo(x, y + h, x, y + h - r)
  s.lineTo(x, y + r)
  s.quadraticCurveTo(x, y, x + r, y)
  return s
}

/** A procedural phone built from the spec: body, glass, screen, island, cameras, buttons. */
export function buildProceduralPhone(spec: DeviceSpec): DeviceObject {
  const group = new Group()
  group.name = spec.id
  const { width: W, height: H, depth: D, cornerRadius: R } = spec.body
  const front = D / 2

  // Body: extruded rounded rectangle with a generous bevel for the polished rim.
  const bt = D * 0.3
  const bs = Math.min(R * 0.5, D * 0.32)
  const bodyGeo = new ExtrudeGeometry(roundedRect(W - 2 * bs, H - 2 * bs, R - bs), {
    depth: D - 2 * bt,
    bevelEnabled: true,
    bevelThickness: bt,
    bevelSize: bs,
    bevelSegments: 8,
    curveSegments: 32,
  })
  bodyGeo.translate(0, 0, -(D - 2 * bt) / 2)
  const frameMat = new MeshPhysicalMaterial({ clearcoat: 0.6, clearcoatRoughness: 0.2 })
  group.add(new Mesh(bodyGeo, frameMat))

  // Front glass with the black border around the display.
  const glassMat = new MeshPhysicalMaterial({ color: '#030304', roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03 })
  const frontGlass = new Mesh(new ShapeGeometry(roundedRect(W - 0.014, H - 0.014, R - 0.007), 32), glassMat)
  frontGlass.position.z = front + 0.0004
  group.add(frontGlass)

  // Display.
  const { width: SW, height: SH, cornerRadius: SR } = spec.screen
  const screen = new ScreenMaterial(SW, SH, SR)
  const screenMesh = new Mesh(new PlaneGeometry(SW, SH), screen)
  screenMesh.position.z = screenSurfaceZ(spec)
  screenMesh.renderOrder = 1
  group.add(screenMesh)

  // Reflection layer: black + additive blending = only the specular reflection is added.
  const glareMat = new MeshStandardMaterial({
    color: '#000000', roughness: 0.22, metalness: 0, transparent: true, blending: AdditiveBlending,
    // Additive: opacity scales the reflection (envMapIntensity is ignored with scene.environment).
    depthWrite: false, opacity: 0.22,
  })
  const glare = new Mesh(new ShapeGeometry(roundedRect(W - 0.014, H - 0.014, R - 0.007), 32), glareMat)
  glare.position.z = screenSurfaceZ(spec) + 0.0008
  glare.renderOrder = 3
  group.add(glare)

  // Front camera cut-out.
  // Real camera islands read as pure black, so skip lighting entirely.
  const islandMat = new MeshBasicMaterial({ color: '#000000' })
  if (spec.island !== 'none') {
    const isDynamic = spec.island === 'dynamic'
    const iw = isDynamic ? SW * 0.3 : 0.05, ih = isDynamic ? 0.082 : 0.05
    const island = new Mesh(new ShapeGeometry(roundedRect(iw, ih, ih / 2), 24), islandMat)
    island.position.set(0, SH / 2 - (isDynamic ? 0.075 : 0.06), screenSurfaceZ(spec) + 0.0004)
    island.renderOrder = 2
    group.add(island)
  }

  // Back glass.
  const backMat = new MeshPhysicalMaterial({ roughness: 0.42, metalness: 0.15, clearcoat: 0.4 })
  const back = new Mesh(new ShapeGeometry(roundedRect(W - 0.014, H - 0.014, R - 0.007), 32), backMat)
  back.position.z = -front - 0.0004
  back.rotation.y = Math.PI
  group.add(back)

  // Camera module (viewed from the back, "top-left" is local +x).
  const bumpMat = new MeshPhysicalMaterial({ roughness: 0.25, metalness: 0.2, clearcoat: 1 })
  const lensMat = new MeshPhysicalMaterial({ color: '#07080b', roughness: 0.05, metalness: 0.4, clearcoat: 1 })
  const ringMat = frameMat
  const lens = (x: number, y: number, r: number, z: number) => {
    const ring = new Mesh(new CylinderGeometry(r * 1.18, r * 1.18, 0.022, 40), ringMat)
    ring.rotation.x = Math.PI / 2
    ring.position.set(x, y, z - 0.011)
    const glass = new Mesh(new CylinderGeometry(r, r, 0.024, 40), lensMat)
    glass.rotation.x = Math.PI / 2
    glass.position.set(x, y, z - 0.012)
    group.add(ring, glass)
  }
  if (spec.cameraBump === 'bar') {
    const bw = W - 0.14, bh = 0.2
    const bar = new Mesh(new ExtrudeGeometry(roundedRect(bw, bh, bh / 2), { depth: 0.018, bevelEnabled: false, curveSegments: 24 }), bumpMat)
    bar.position.set(0, H / 2 - 0.26, -front - 0.018)
    group.add(bar)
    lens(bw / 2 - 0.12, H / 2 - 0.26, 0.055, -front - 0.018)
    lens(bw / 2 - 0.3, H / 2 - 0.26, 0.055, -front - 0.018)
  } else {
    const s = W * 0.42
    const cx = W / 2 - 0.05 - s / 2, cy = H / 2 - 0.05 - s / 2
    const bump = new Mesh(new ExtrudeGeometry(roundedRect(s, s, s * 0.26), { depth: 0.016, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 3, curveSegments: 24 }), bumpMat)
    bump.position.set(cx, cy, -front - 0.016)
    group.add(bump)
    const z = -front - 0.02
    const off = s * 0.24, r = s * 0.17
    lens(cx + off, cy + off, r, z)
    lens(cx + off, cy - off, r, z)
    if (spec.cameraBump === 'triple') lens(cx - off, cy, r, z)
  }

  // Side buttons.
  const button = (x: number, y: number, h: number) => {
    const b = new Mesh(new BoxGeometry(0.014, h, D * 0.38), frameMat)
    b.position.set(x, y, 0)
    group.add(b)
  }
  button(W / 2 + 0.004, H * 0.17, 0.2)
  button(-W / 2 - 0.004, H * 0.22, 0.13)
  button(-W / 2 - 0.004, H * 0.08, 0.13)
  button(-W / 2 - 0.004, H * 0.34, 0.06)

  return {
    group,
    screen,
    setFinish(f) {
      frameMat.color.set(f.color)
      frameMat.metalness = f.metalness
      frameMat.roughness = f.roughness
      const c = new Color(f.color)
      backMat.color.copy(c).multiplyScalar(0.8)
      bumpMat.color.copy(c).multiplyScalar(0.85)
    },
    dispose() {
      group.traverse((o) => {
        if (o instanceof Mesh) {
          o.geometry.dispose()
          ;(Array.isArray(o.material) ? o.material : [o.material]).forEach((m: Material) => m.dispose())
        }
      })
    },
  }
}
