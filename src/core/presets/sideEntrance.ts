import { keys } from '../animation/keyframes'
import { dirSign, directionParam, easeParam, intensityParam } from './common'
import { num, str, type Preset, type PresetCurve } from './types'

export const sideEntrance: Preset = {
  id: 'side-entrance',
  name: 'Side Entrance',
  description: 'Slides in from the side of the frame and settles front-facing.',
  target: 'device',
  category: 'entrance',
  defaultDuration: 2,
  params: [intensityParam, directionParam('left'), easeParam('product')],
  build(p, ctx) {
    const k = num(p, 'intensity', 1)
    const s = dirSign(str(p, 'direction')) // +1 enters from the left, -1 from the right
    const e = str(p, 'ease', 'product')
    // Horizontal distance that puts the device fully outside the frame at u = 0.
    const offscreen = (ctx.camera.distance * Math.tan((ctx.camera.fov * Math.PI) / 360) * ctx.aspect + 1) * k

    // TODO(you): shape the entrance. Currently it's a flat slide. Ideas: which channels
    // move (position.x/z, rotation.y/z), whether rotation lags behind position (keys at
    // different u), and whether it overshoots before settling (e.g. ease 'spring').
    const curves: PresetCurve[] = [
      { channel: 'position.x', mode: 'offset', sample: keys([{ u: 0, v: -offscreen * s }, { u: 1, v: 0 }], e) },
    ]
    return curves
  },
}
