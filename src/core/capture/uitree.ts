/**
 * Semantic view of a captured screen: the elements an agent (or a human) can name and act
 * on. Parsed from UIAutomator XML (Android, incl. Flutter/Compose semantics); other sources
 * produce the same `UiElement` shape, so takes and tools stay source-agnostic.
 */
export interface UiElement {
  /** Stable within one look: "e1", "e2"… */
  ref: string
  role: string
  text: string
  /** Accessibility label (content-desc on Android; Flutter puts its labels here). */
  desc: string
  id: string
  /** Pixel bounds [x1, y1, x2, y2] in device pixels. */
  bounds: [number, number, number, number]
  clickable: boolean
  scrollable: boolean
  editable: boolean
  focused: boolean
}

export interface UiTree {
  width: number
  height: number
  package: string
  elements: UiElement[]
}

const ATTR = /([\w-]+)="([^"]*)"/g

function decode(s: string) {
  return s
    .replace(/&#10;/g, '\n')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function roleOf(cls: string, a: Record<string, string>) {
  if (a['password'] === 'true' || /EditText/.test(cls)) return 'input'
  if (/Button/.test(cls)) return 'button'
  if (/CheckBox|Switch|Toggle/.test(cls)) return 'toggle'
  if (/ImageView|Image$/.test(cls)) return 'image'
  if (a['scrollable'] === 'true' || /RecyclerView|ScrollView|ListView|Pager/.test(cls)) return 'list'
  if (/TextView/.test(cls)) return 'text'
  if (a['clickable'] === 'true') return 'button'
  return 'view'
}

/**
 * Keeps only elements worth naming: anything with a label or text, or that can be tapped,
 * typed into or scrolled. Layout-only wrappers are dropped.
 */
export function parseUiAutomator(xml: string): UiTree {
  const elements: UiElement[] = []
  let width = 0, height = 0, pkg = ''
  for (const m of xml.matchAll(/<node\b([^>]*?)\/?>/g)) {
    const a: Record<string, string> = {}
    for (const [, k, v] of m[1].matchAll(ATTR)) a[k] = decode(v)
    const b = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(a['bounds'] ?? '')
    if (!b) continue
    const bounds = [Number(b[1]), Number(b[2]), Number(b[3]), Number(b[4])] as UiElement['bounds']
    width = Math.max(width, bounds[2])
    height = Math.max(height, bounds[3])
    if (!pkg && a['package']) pkg = a['package']
    const text = (a['text'] ?? '').trim()
    const desc = (a['content-desc'] ?? '').trim()
    const clickable = a['clickable'] === 'true' || a['long-clickable'] === 'true'
    const scrollable = a['scrollable'] === 'true'
    const cls = a['class'] ?? ''
    const editable = /EditText/.test(cls)
    const area = (bounds[2] - bounds[0]) * (bounds[3] - bounds[1])
    if (area <= 0) continue
    if (!text && !desc && !clickable && !scrollable && !editable) continue
    // Separators and decorative punctuation are not things anyone wants to act on.
    if (!clickable && !scrollable && !editable && !/[\p{L}\p{N}]/u.test(text + desc)) continue
    elements.push({
      ref: `e${elements.length + 1}`,
      role: roleOf(cls, a),
      text,
      desc,
      id: (a['resource-id'] ?? '').replace(/^.*:id\//, ''),
      bounds,
      clickable,
      scrollable,
      editable,
      focused: a['focused'] === 'true',
    })
  }
  return { width, height, package: pkg, elements }
}

export type Target =
  | { ref: string }
  | { text: string }
  | { desc: string }
  | { id: string }
  /** Normalised point (0..1 of the screen), device-independent. */
  | { at: [number, number] }

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

/**
 * Resolves a target to an element. Text/desc matching is accent- and case-insensitive:
 * exact match beats prefix beats substring; tappable and smaller elements win ties.
 */
export function findElement(tree: UiTree, target: Target): UiElement | null {
  if ('ref' in target) return tree.elements.find((e) => e.ref === target.ref) ?? null
  if ('id' in target) return tree.elements.find((e) => e.id === target.id) ?? null
  if ('at' in target) return null
  const q = norm('text' in target ? target.text : target.desc)
  const fields = (e: UiElement) => ('text' in target ? [e.text, e.desc] : [e.desc, e.text]).map(norm).filter(Boolean)
  let best: { e: UiElement; score: number } | null = null
  for (const e of tree.elements) {
    let s = 0
    for (const f of fields(e)) {
      if (f === q) s = Math.max(s, 3)
      else if (f.startsWith(q)) s = Math.max(s, 2)
      else if (f.includes(q)) s = Math.max(s, 1)
    }
    if (!s) continue
    const area = (e.bounds[2] - e.bounds[0]) * (e.bounds[3] - e.bounds[1])
    const score = s * 10 + (e.clickable ? 3 : 0) - area / (tree.width * tree.height || 1)
    if (!best || score > best.score) best = { e, score }
  }
  return best?.e ?? null
}

/** Pixel point for a target (centre of the element, or the normalised point). */
export function targetPoint(tree: UiTree, target: Target): [number, number] | null {
  if ('at' in target) return [Math.round(target.at[0] * tree.width), Math.round(target.at[1] * tree.height)]
  const e = findElement(tree, target)
  return e ? [Math.round((e.bounds[0] + e.bounds[2]) / 2), Math.round((e.bounds[1] + e.bounds[3]) / 2)] : null
}

/** Compact, token-cheap description for agents: one line per element. */
export function describeTree(tree: UiTree): string[] {
  return tree.elements.map((e) => {
    const label = [e.text, e.desc && e.desc !== e.text ? e.desc : ''].filter(Boolean).join(' | ').replace(/\n+/g, ' / ').slice(0, 80)
    const flags = [e.clickable && 'tap', e.scrollable && 'scroll', e.editable && 'input', e.focused && 'focused'].filter(Boolean).join(',')
    const [x1, y1, x2, y2] = e.bounds
    const box = `${(x1 / tree.width).toFixed(2)},${(y1 / tree.height).toFixed(2)}–${(x2 / tree.width).toFixed(2)},${(y2 / tree.height).toFixed(2)}`
    return `${e.ref} ${e.role}${flags ? `[${flags}]` : ''} "${label}"${e.id ? ` #${e.id}` : ''} @${box}`
  })
}
