import { EASE_IDS } from '../animation/easing'
import type { EaseId } from '../schema/project'
import type { ParamSpec } from './types'

export const easeParam = (def: EaseId): ParamSpec => ({
  key: 'ease',
  label: 'Easing',
  type: 'select',
  options: EASE_IDS.map((e) => ({ value: e, label: e })),
  default: def,
})

export const intensityParam: ParamSpec = {
  key: 'intensity', label: 'Intensity', type: 'number', min: 0, max: 2, step: 0.05, default: 1,
}

export const directionParam = (def: 'left' | 'right' = 'left'): ParamSpec => ({
  key: 'direction',
  label: 'Direction',
  type: 'select',
  options: [
    { value: 'left', label: 'From left' },
    { value: 'right', label: 'From right' },
  ],
  default: def,
})

/** +1 for "from left" (motion goes left → right), -1 for "from right". */
export const dirSign = (d: string) => (d === 'right' ? -1 : 1)
