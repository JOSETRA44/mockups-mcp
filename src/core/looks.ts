import type { Background, Lighting } from './schema/project'

/**
 * Looks bundle background + lighting + device finish into one decision, the way Shots.so
 * and Rotato let people pick a mood instead of tuning ten sliders.
 */
export interface Look {
  id: string
  name: string
  background: Background
  lighting: Lighting
  /** Preferred finish id per finish family (first match wins). */
  finishes: string[]
}

export const LOOKS: Look[] = [
  { id: 'midnight', name: 'Midnight', background: { kind: 'gradient', color: '#0b1023', color2: '#2b3a8f', angle: 160 }, lighting: { preset: 'studio', intensity: 1, environment: 1 }, finishes: ['black', 'obsidian'] },
  { id: 'studio-white', name: 'Studio White', background: { kind: 'gradient', color: '#f5f6f8', color2: '#dfe3ea', angle: 180 }, lighting: { preset: 'soft', intensity: 1.1, environment: 1.2 }, finishes: ['white', 'porcelain'] },
  { id: 'sunset', name: 'Sunset', background: { kind: 'gradient', color: '#ff7a59', color2: '#7b2ff7', angle: 150 }, lighting: { preset: 'studio', intensity: 1.1, environment: 1 }, finishes: ['natural', 'porcelain'] },
  { id: 'mint', name: 'Mint', background: { kind: 'gradient', color: '#d9f7ea', color2: '#7fd8be', angle: 170 }, lighting: { preset: 'soft', intensity: 1, environment: 1.1 }, finishes: ['white', 'mint'] },
  { id: 'noir', name: 'Noir', background: { kind: 'solid', color: '#050506', color2: '#050506', angle: 180 }, lighting: { preset: 'dramatic', intensity: 1.2, environment: 0.8 }, finishes: ['black', 'obsidian'] },
  { id: 'ocean', name: 'Ocean', background: { kind: 'gradient', color: '#031b34', color2: '#0fb5ae', angle: 200 }, lighting: { preset: 'dramatic', intensity: 1, environment: 1 }, finishes: ['blue', 'obsidian'] },
]

const hexToRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
const rgbToHex = (c: number[]) => `#${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`
const luminance = (h: string) => {
  const [r, g, b] = hexToRgb(h)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * A look derived from the media's palette: the most saturated colour becomes a deep-to-rich
 * gradient so the app's brand colour carries the scene without competing with the UI.
 */
export function lookFromPalette(palette: string[]): Look | null {
  if (!palette.length) return null
  const sat = (h: string) => {
    const c = hexToRgb(h)
    return Math.max(...c) - Math.min(...c)
  }
  const brand = [...palette].sort((a, b) => sat(b) - sat(a))[0]
  const c = hexToRgb(brand)
  const deep = rgbToHex(c.map((v) => v * 0.22))
  const rich = rgbToHex(c.map((v) => v * 0.85))
  const light = luminance(brand) > 0.6
  return {
    id: 'match-media',
    name: 'Match media',
    background: { kind: 'gradient', color: light ? rich : deep, color2: light ? '#ffffff' : rich, angle: 160 },
    lighting: { preset: 'studio', intensity: 1, environment: 1 },
    finishes: light ? ['white', 'porcelain'] : ['black', 'obsidian'],
  }
}
