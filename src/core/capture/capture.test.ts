import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { StepSchema, TakeSchema } from './steps'
import { analyzeMotion, isBlankFrame } from './trim'
import { describeTree, findElement, parseUiAutomator, targetPoint } from './uitree'

const flutter = readFileSync(new URL('./fixture-flutter.xml', import.meta.url), 'utf8')

describe('uitree (real Flutter dump from UniCali)', () => {
  const tree = parseUiAutomator(flutter)

  it('keeps labelled and tappable elements, drops layout wrappers and separators', () => {
    expect(tree.width).toBe(1080)
    expect(tree.height).toBe(2400)
    expect(tree.package).toBe('com.mantra.unsap')
    const labels = tree.elements.map((e) => e.desc || e.text)
    expect(labels).toContain('Continuar con Google')
    expect(labels).toContain('Solo ver mis notas')
    expect(labels.some((l) => l.trim() === '·')).toBe(false)
    expect(tree.elements.length).toBeLessThan(15)
  })

  it('finds elements by label ignoring case and accents, preferring tappable ones', () => {
    const e = findElement(tree, { text: 'iniciar sesion' })
    expect(e?.desc).toMatch(/Iniciar sesión/)
    expect(findElement(tree, { desc: 'crear cuenta' })?.clickable).toBe(true)
    expect(findElement(tree, { text: 'does not exist' })).toBeNull()
  })

  it('resolves points, including normalised coordinates', () => {
    const p = targetPoint(tree, { text: 'Crear cuenta' })!
    expect(p[1]).toBeGreaterThan(1600)
    expect(p[1]).toBeLessThan(1900)
    expect(targetPoint(tree, { at: [0.5, 0.25] })).toEqual([540, 600])
  })

  it('describes the screen compactly for agents', () => {
    const lines = describeTree(tree)
    expect(lines.some((l) => /e\d+ button\[tap\] "Continuar con Google"/.test(l))).toBe(true)
    expect(lines.join('\n').length).toBeLessThan(1500)
  })
})

describe('take steps', () => {
  it('accepts a readable take and fills pacing defaults', () => {
    const take = TakeSchema.parse({ label: 'Grades', steps: [{ tap: { text: 'Notas' } }, { scroll: 'down' }, { wait: 800 }] })
    expect(take.leadIn).toBe(700)
    expect(take.steps[0]).toMatchObject({ after: 700 })
    expect(take.steps[1]).toMatchObject({ amount: 0.45, speed: 'normal' })
  })

  it('rejects ambiguous or misspelled steps', () => {
    expect(StepSchema.safeParse({ tap: { text: 'x' }, scroll: 'down' }).success).toBe(false)
    expect(StepSchema.safeParse({ tapp: { text: 'x' } }).success).toBe(false)
    expect(StepSchema.safeParse({ tap: { at: [1.5, 0] } }).success).toBe(false)
  })
})

describe('motion trim', () => {
  // 30 fps: still 1 s, tap transition 0.5 s, still 1 s, scroll 1 s, still 1.5 s.
  const fps = 30
  const curve = [
    ...Array(30).fill(0.001), ...Array(15).fill(0.08), ...Array(30).fill(0.001),
    ...Array(30).fill(0.05), ...Array(45).fill(0.001),
  ]
  const m = analyzeMotion(curve, fps)

  it('trims dead time but keeps a lead-in and a tail', () => {
    expect(m.in).toBeCloseTo(1 - 0.35, 1)
    expect(m.out).toBeCloseTo(3.5 + 0.8, 1)
  })

  it('finds the settled moments after each action, the last one as poster', () => {
    expect(m.active).toHaveLength(2)
    expect(m.moments).toHaveLength(2)
    expect(m.moments[0]).toBeGreaterThan(1.5)
    expect(m.moments[0]).toBeLessThan(2.5)
    expect(m.poster).toBe(m.moments[1])
  })

  it('a take that ends in motion ends on its result (VFR recorders stop at the last change)', () => {
    const vfr = analyzeMotion([...Array(20).fill(0.001), ...Array(25).fill(0.06)], 30)
    expect(vfr.poster).toBeCloseTo(45 / 30 - 0.05, 2)
    expect(vfr.out).toBeCloseTo(1.5, 2)
  })

  it('handles a static clip', () => {
    const s = analyzeMotion(Array(60).fill(0), 30)
    expect(s.in).toBe(0)
    expect(s.poster).toBe(1)
  })

  it('detects protected (black) frames', () => {
    const black = new Uint8ClampedArray(64 * 64 * 4)
    const ui = new Uint8ClampedArray(64 * 64 * 4).fill(200)
    expect(isBlankFrame(black)).toBe(true)
    expect(isBlankFrame(ui)).toBe(false)
  })
})
