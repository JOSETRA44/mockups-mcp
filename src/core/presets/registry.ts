import { cameraOrbit, pullOut, pushIn, screenFocus } from './camera'
import { floating, flyBy, heroReveal, heroSpin, tilt } from './device'
import { sideEntrance } from './sideEntrance'
import type { Preset } from './types'

/** Adding a preset = writing one object and listing it here. */
export const PRESETS: Preset[] = [
  heroReveal,
  sideEntrance,
  flyBy,
  heroSpin,
  tilt,
  floating,
  pushIn,
  pullOut,
  cameraOrbit,
  screenFocus,
]

const byId = new Map(PRESETS.map((p) => [p.id, p]))
export const getPreset = (id: string) => byId.get(id)
