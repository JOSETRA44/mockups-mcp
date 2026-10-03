import { keys } from '../animation/keyframes'
import { frameScreenRegion } from '../camera/framing'
import { easeParam } from './common'
import { bool, num, str, type Preset, type PresetCurve } from './types'

export const pushIn: Preset = {
  id: 'push-in',
  name: 'Push In',
  description: 'Camera dollies toward the device.',
  target: 'camera',
  category: 'camera',
  defaultDuration: 2.5,
  params: [
    { key: 'amount', label: 'Amount', type: 'number', min: 0.05, max: 0.85, step: 0.01, default: 0.35 },
    easeParam('product'),
  ],
  build(p, ctx) {
    const d = -num(p, 'amount', 0.35) * ctx.camera.distance
    return [{ channel: 'distance', mode: 'offset', sample: keys([{ u: 0, v: 0 }, { u: 1, v: d }], str(p, 'ease')) }]
  },
}

export const pullOut: Preset = {
  id: 'pull-out',
  name: 'Pull Out',
  description: 'Starts close on the device and pulls back to reveal it.',
  target: 'camera',
  category: 'camera',
  defaultDuration: 2.5,
  params: [
    { key: 'amount', label: 'Amount', type: 'number', min: 0.05, max: 0.85, step: 0.01, default: 0.45 },
    easeParam('product'),
  ],
  build(p, ctx) {
    const d = -num(p, 'amount', 0.45) * ctx.camera.distance
    return [{ channel: 'distance', mode: 'offset', sample: keys([{ u: 0, v: d }, { u: 1, v: 0 }], str(p, 'ease')) }]
  },
}

export const cameraOrbit: Preset = {
  id: 'camera-orbit',
  name: 'Camera Orbit',
  description: 'Camera arcs around the device.',
  target: 'camera',
  category: 'camera',
  defaultDuration: 4,
  params: [
    { key: 'angle', label: 'Arc', type: 'number', min: 10, max: 360, step: 5, default: 60, unit: '°' },
    { key: 'lift', label: 'Vertical arc', type: 'number', min: -30, max: 30, step: 1, default: 8, unit: '°' },
    {
      key: 'direction', label: 'Direction', type: 'select', default: 'cw',
      options: [{ value: 'cw', label: 'Clockwise' }, { value: 'ccw', label: 'Counter-clockwise' }],
    },
    easeParam('easeInOut'),
  ],
  build(p) {
    const a = num(p, 'angle', 60) * (str(p, 'direction') === 'ccw' ? -1 : 1)
    const lift = num(p, 'lift', 8)
    const e = str(p, 'ease')
    return [
      { channel: 'yaw', mode: 'offset', sample: keys([{ u: 0, v: -a / 2 }, { u: 1, v: a / 2 }], e) },
      { channel: 'pitch', mode: 'offset', sample: keys([{ u: 0, v: 0 }, { u: 0.5, v: lift }, { u: 1, v: 0 }], e) },
    ]
  },
}

/**
 * Screen Focus: frames a rectangle of the screen content. The rectangle is given in
 * screen UV (0,0 = top-left) and the camera eases to face it, holds, and releases.
 */
export const screenFocus: Preset = {
  id: 'screen-focus',
  name: 'Screen Focus',
  description: 'Zooms the camera onto a region of the app screen.',
  target: 'camera',
  category: 'camera',
  defaultDuration: 3,
  params: [
    { key: 'focusX', label: 'Focus X', type: 'number', min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: 'focusY', label: 'Focus Y', type: 'number', min: 0, max: 1, step: 0.01, default: 0.35 },
    { key: 'size', label: 'Region height', type: 'number', min: 0.1, max: 1, step: 0.01, default: 0.6 },
    { key: 'width', label: 'Region width', type: 'number', min: 0.1, max: 1, step: 0.01, default: 0.6 },
    { key: 'face', label: 'Face screen', type: 'number', min: 0, max: 1, step: 0.05, default: 1 },
    { key: 'release', label: 'Zoom back out', type: 'boolean', default: true },
    easeParam('product'),
  ],
  build(p, ctx) {
    if (!ctx.device) return []
    const e = str(p, 'ease')
    const face = num(p, 'face', 1)
    const region = { x: num(p, 'focusX', 0.5), y: num(p, 'focusY', 0.35), size: num(p, 'size', 0.6), w: num(p, 'width', num(p, 'size', 0.6)) }
    const goal = frameScreenRegion(ctx.device, region, ctx.camera, ctx.aspect, face)

    const release = bool(p, 'release', true)
    const curve = (v: number) =>
      release
        ? keys([{ u: 0, v: 0 }, { u: 0.32, v, ease: 'linear' }, { u: 0.68, v }, { u: 1, v: 0 }], e)
        : keys([{ u: 0, v: 0 }, { u: 0.5, v }], e)

    const out: PresetCurve[] = [
      { channel: 'target.x', mode: 'offset', sample: curve(goal.target[0] - ctx.camera.target[0]) },
      { channel: 'target.y', mode: 'offset', sample: curve(goal.target[1] - ctx.camera.target[1]) },
      { channel: 'target.z', mode: 'offset', sample: curve(goal.target[2] - ctx.camera.target[2]) },
      { channel: 'distance', mode: 'offset', sample: curve(goal.distance - ctx.camera.distance) },
    ]
    if (face > 0) {
      out.push(
        { channel: 'yaw', mode: 'offset', sample: curve(goal.yaw - ctx.camera.yaw) },
        { channel: 'pitch', mode: 'offset', sample: curve(goal.pitch - ctx.camera.pitch) },
      )
    }
    return out
  },
}
