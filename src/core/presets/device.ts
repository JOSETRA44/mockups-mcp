import { keys } from '../animation/keyframes'
import { dirSign, directionParam, easeParam, intensityParam } from './common'
import { bool, num, str, type Preset } from './types'

export const heroReveal: Preset = {
  id: 'hero-reveal',
  name: 'Hero Reveal',
  description: 'Rises from below while untwisting into a front-facing hero pose.',
  target: 'device',
  category: 'entrance',
  defaultDuration: 2.2,
  params: [intensityParam, directionParam('left'), easeParam('product')],
  build(p, ctx) {
    const k = num(p, 'intensity', 1)
    const s = dirSign(str(p, 'direction'))
    const e = str(p, 'ease', 'product')
    const h = ctx.device?.spec.body.height ?? 2
    const from = (v: number) => keys([{ u: 0, v }, { u: 1, v: 0 }], e)
    return [
      { channel: 'position.y', mode: 'offset', sample: from(-h * 1.6 * k) },
      { channel: 'rotation.x', mode: 'offset', sample: from(32 * k) },
      { channel: 'rotation.y', mode: 'offset', sample: from(-45 * k * s) },
      { channel: 'rotation.z', mode: 'offset', sample: from(10 * k * s) },
      { channel: 'scale', mode: 'offset', sample: from(-0.2 * k * (ctx.device?.scale ?? 1)) },
    ]
  },
}

export const heroSpin: Preset = {
  id: 'hero-spin',
  name: 'Hero Spin',
  description: 'A full turn around the vertical axis, landing front-facing.',
  target: 'device',
  category: 'emphasis',
  defaultDuration: 2.4,
  params: [
    { key: 'turns', label: 'Turns', type: 'number', min: 0.5, max: 3, step: 0.5, default: 1 },
    directionParam('left'),
    easeParam('easeInOut'),
  ],
  build(p) {
    const deg = 360 * num(p, 'turns', 1) * dirSign(str(p, 'direction'))
    return [{ channel: 'rotation.y', mode: 'offset', sample: keys([{ u: 0, v: -deg }, { u: 1, v: 0 }], str(p, 'ease')) }]
  },
}

export const tilt: Preset = {
  id: 'tilt',
  name: 'Tilt',
  description: 'Leans the device to show depth, optionally returning to rest.',
  target: 'device',
  category: 'emphasis',
  defaultDuration: 1.8,
  params: [
    { key: 'angleX', label: 'Tilt back', type: 'number', min: -45, max: 45, step: 1, default: 18, unit: '°' },
    { key: 'angleY', label: 'Turn', type: 'number', min: -60, max: 60, step: 1, default: -25, unit: '°' },
    { key: 'return', label: 'Return to start', type: 'boolean', default: false },
    easeParam('easeInOut'),
  ],
  build(p) {
    const e = str(p, 'ease')
    const back = bool(p, 'return')
    const curve = (a: number) =>
      back ? keys([{ u: 0, v: 0 }, { u: 0.5, v: a }, { u: 1, v: 0 }], e) : keys([{ u: 0, v: 0 }, { u: 1, v: a }], e)
    return [
      { channel: 'rotation.x', mode: 'offset', sample: curve(num(p, 'angleX')) },
      { channel: 'rotation.y', mode: 'offset', sample: curve(num(p, 'angleY')) },
    ]
  },
}

export const floating: Preset = {
  id: 'floating',
  name: 'Floating Device',
  description: 'Gentle hovering loop. Stack it on top of other motions.',
  target: 'device',
  category: 'loop',
  defaultDuration: 4,
  params: [
    intensityParam,
    { key: 'cycles', label: 'Cycles', type: 'number', min: 0.5, max: 4, step: 0.5, default: 1 },
  ],
  build(p, ctx) {
    const k = num(p, 'intensity', 1)
    const c = num(p, 'cycles', 1)
    const h = ctx.device?.spec.body.height ?? 2
    const wave = (amp: number, phase: number) => (u: number) => amp * Math.sin(2 * Math.PI * c * u + phase)
    return [
      { channel: 'position.y', mode: 'offset', sample: wave(0.04 * h * k, 0) },
      { channel: 'rotation.x', mode: 'offset', sample: wave(2.5 * k, Math.PI / 2) },
      { channel: 'rotation.y', mode: 'offset', sample: wave(5 * k, Math.PI / 3) },
      { channel: 'rotation.z', mode: 'offset', sample: wave(1.2 * k, Math.PI) },
    ]
  },
}

export const flyBy: Preset = {
  id: 'fly-by',
  name: 'Fly By',
  description: 'Sweeps across the frame from one side to the other.',
  target: 'device',
  category: 'entrance',
  defaultDuration: 2.5,
  params: [intensityParam, directionParam('left'), easeParam('easeInOut')],
  build(p, ctx) {
    const k = num(p, 'intensity', 1)
    const s = dirSign(str(p, 'direction'))
    const e = str(p, 'ease')
    const span = (ctx.camera.distance * 0.75 + 1) * k
    return [
      { channel: 'position.x', mode: 'offset', sample: keys([{ u: 0, v: -span * s }, { u: 1, v: span * s }], e) },
      { channel: 'rotation.y', mode: 'offset', sample: keys([{ u: 0, v: 35 * s }, { u: 1, v: -35 * s }], e) },
      { channel: 'rotation.z', mode: 'offset', sample: keys([{ u: 0, v: -6 * s }, { u: 1, v: 6 * s }], e) },
    ]
  },
}
