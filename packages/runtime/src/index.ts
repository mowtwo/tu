import { Signal } from 'signal-polyfill'

export const VERSION = '0.0.0'

export { Signal }

export type Child = VNode | string | number | null | undefined | Child[]

export interface VNode {
  tag: string
  props: Record<string, unknown>
  children: Child[]
}

/** Construct a virtual node. Compiled Tu emits calls to this. */
export function h(
  tag: string,
  props: Record<string, unknown> = {},
  children: Child[] = []
): VNode {
  return { tag, props, children }
}

/** Render a VNode (or text/number/array) to an HTML string. M1.0 SSR target. */
export function renderToString(node: Child): string {
  if (node == null) return ''
  if (typeof node === 'string') return escapeText(node)
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) {
    let out = ''
    for (const c of node) out += renderToString(c)
    return out
  }
  return renderVNode(node)
}

function renderVNode(node: VNode): string {
  let propStr = ''
  for (const [k, v] of Object.entries(node.props)) {
    if (k === 'key') continue
    if (v == null || v === false) continue
    // Event handlers and other functions have no SSR representation.
    if (typeof v === 'function') continue
    if (v === true) {
      propStr += ` ${k}`
      continue
    }
    propStr += ` ${k}="${escapeAttr(String(v))}"`
  }
  if (VOID_ELEMENTS.has(node.tag)) {
    return `<${node.tag}${propStr}>`
  }
  let childStr = ''
  if (RAW_TEXT_ELEMENTS.has(node.tag)) {
    // <style> and <script> are HTML raw-text elements: their text content is
    // NOT HTML-escaped. We still render nested vnodes (rare but valid) normally.
    for (const c of node.children) {
      childStr += renderRawTextChild(c)
    }
  } else {
    for (const c of node.children) {
      childStr += renderToString(c)
    }
  }
  return `<${node.tag}${propStr}>${childStr}</${node.tag}>`
}

function renderRawTextChild(node: Child): string {
  if (node == null) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) {
    let out = ''
    for (const c of node) out += renderRawTextChild(c)
    return out
  }
  return renderVNode(node)
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'source', 'track', 'wbr',
])

/** HTML raw-text elements: their text content is not HTML-escaped. */
const RAW_TEXT_ELEMENTS = new Set(['style', 'script'])

// ─── Browser mount (CSR) ───────────────────────────────────────────────────
//
// Build real DOM from a vnode thunk and re-run the thunk whenever any Signal
// it reads becomes stale. M1.7 upgrades this from naive replace-children to a
// keyed vnode→DOM diff: same-tag elements are reused (focus / scroll / input
// state / CSS animations survive), event listeners rebind only when the
// handler reference changes, and reorders move existing nodes instead of
// destroying them.

type NormalizedChild = VNode | string | number

interface ElInstance {
  kind: 'el'
  tag: string
  /** Last-applied props snapshot — drives the next prop diff. */
  props: Record<string, unknown>
  el: Element
  children: Instance[]
  /** Currently-bound event listeners, keyed by lowercased event name. */
  handlers: Record<string, EventListener>
}

interface TextInstance {
  kind: 'text'
  text: string
  el: Text
}

type Instance = ElInstance | TextInstance

/**
 * Properties that must be set as DOM properties rather than HTML attributes
 * — assigning to `.value` updates an input live, while `setAttribute('value', …)`
 * only sets the initial value.
 */
const PROPERTY_PROPS = new Set(['value', 'checked', 'selected'])

/**
 * Mount a reactive component into a DOM container.
 *
 * `thunk` is invoked once on mount and again, scheduled via microtask, every
 * time any Signal it reads becomes stale. Returns a `stop()` function that
 * tears the subscription down.
 *
 * Browser-only — requires `document`. Use `renderToString` for SSR.
 */
export function mount(thunk: () => Child, container: Element): () => void {
  let mounted: Instance[] = []
  const render = () => {
    mounted = patchChildren(container, mounted, [thunk()])
  }
  // The canonical TC39 Signal effect pattern: a Computed wraps the side
  // effect, and a Watcher schedules a re-pull on a microtask after any read
  // signal becomes stale.
  const c = new Signal.Computed(() => {
    render()
  })
  const w = new Signal.subtle.Watcher(() => {
    queueMicrotask(() => {
      for (const s of w.getPending()) s.get()
      w.watch()
    })
  })
  w.watch(c)
  c.get() // initial render
  return () => {
    w.unwatch(c)
  }
}

function flatten(raw: Child[]): NormalizedChild[] {
  const out: NormalizedChild[] = []
  for (const c of raw) flattenInto(out, c)
  return out
}

function flattenInto(out: NormalizedChild[], c: Child): void {
  if (c == null) return
  if (typeof c === 'string') {
    out.push(c)
    return
  }
  if (typeof c === 'number') {
    out.push(c)
    return
  }
  if (Array.isArray(c)) {
    for (const cc of c) flattenInto(out, cc)
    return
  }
  out.push(c)
}

function materializeInstance(child: NormalizedChild): Instance {
  if (typeof child !== 'object') {
    const text = String(child)
    return { kind: 'text', text, el: document.createTextNode(text) }
  }
  const el = document.createElement(child.tag)
  const handlers: Record<string, EventListener> = {}
  for (const [k, v] of Object.entries(child.props)) {
    if (k === 'key') continue
    if (v == null || v === false) continue
    const ev = matchEventProp(k)
    if (ev !== null) {
      if (typeof v === 'function') {
        el.addEventListener(ev, v as EventListener)
        handlers[ev] = v as EventListener
      }
      continue
    }
    if (v === true) {
      el.setAttribute(k, '')
      continue
    }
    if (typeof v === 'function') continue
    if (PROPERTY_PROPS.has(k)) {
      ;(el as unknown as Record<string, unknown>)[k] = v
    } else {
      el.setAttribute(k, String(v))
    }
  }
  const children: Instance[] = []
  for (const c of flatten(child.children)) {
    const ci = materializeInstance(c)
    el.appendChild(ci.el)
    children.push(ci)
  }
  return { kind: 'el', tag: child.tag, props: child.props, el, children, handlers }
}

/**
 * Diff two children lists rooted at `parentEl`, producing the new instance
 * list in the order they should appear. Reuses old instances by `key:` prop
 * (any key) or by index position when no keys are involved. Mismatched
 * shapes are replaced via `materializeInstance`. DOM moves are issued at
 * the end via `insertBefore`.
 */
function patchChildren(
  parentEl: Element,
  oldList: Instance[],
  newRaw: Child[]
): Instance[] {
  const newFlat = flatten(newRaw)
  const oldUsed = new Array(oldList.length).fill(false)
  const newToOld = new Array<number>(newFlat.length).fill(-1)

  // Pass 1 — keyed matches.
  for (let ni = 0; ni < newFlat.length; ni++) {
    const c = newFlat[ni]!
    if (typeof c !== 'object') continue
    const key = c.props['key']
    if (key === undefined) continue
    for (let oi = 0; oi < oldList.length; oi++) {
      if (oldUsed[oi]) continue
      const o = oldList[oi]!
      if (o.kind !== 'el') continue
      if (o.props['key'] !== key) continue
      if (o.tag !== c.tag) continue
      newToOld[ni] = oi
      oldUsed[oi] = true
      break
    }
  }

  // Pass 2 — positional fallback for unkeyed slots that line up.
  for (let ni = 0; ni < newFlat.length; ni++) {
    if (newToOld[ni] !== -1) continue
    if (ni >= oldList.length) break
    if (oldUsed[ni]) continue
    const c = newFlat[ni]!
    const o = oldList[ni]!
    if (typeof c !== 'object' && o.kind === 'text') {
      newToOld[ni] = ni
      oldUsed[ni] = true
      continue
    }
    if (
      typeof c === 'object' &&
      o.kind === 'el' &&
      o.tag === c.tag &&
      o.props['key'] === c.props['key']
    ) {
      newToOld[ni] = ni
      oldUsed[ni] = true
    }
  }

  // Build the new instance list — reuse where matched, materialize where not.
  const newInstances: Instance[] = new Array(newFlat.length)
  for (let ni = 0; ni < newFlat.length; ni++) {
    const oi = newToOld[ni]!
    const c = newFlat[ni]!
    if (oi >= 0) {
      newInstances[ni] = patchInstance(oldList[oi]!, c, parentEl)
    } else {
      newInstances[ni] = materializeInstance(c)
    }
  }

  // Remove old instances that didn't get reused.
  for (let oi = 0; oi < oldList.length; oi++) {
    if (!oldUsed[oi]) parentEl.removeChild(oldList[oi]!.el)
  }

  // Position pass — walk new list forward and insertBefore as needed. New
  // instances aren't in the DOM yet, so this is also where they get
  // appended. Existing instances that are already in the right slot get
  // skipped via the `nextSibling` check, avoiding spurious DOM mutations.
  let cursor: Node | null = parentEl.firstChild
  for (const inst of newInstances) {
    if (cursor === inst.el) {
      cursor = inst.el.nextSibling
    } else {
      parentEl.insertBefore(inst.el, cursor)
    }
  }

  return newInstances
}

function patchInstance(
  oldInst: Instance,
  newChild: NormalizedChild,
  parentEl: Element
): Instance {
  // Type or shape change: text→el or el→text or different tag → replace.
  if (typeof newChild !== 'object') {
    const text = String(newChild)
    if (oldInst.kind === 'text') {
      if (oldInst.text !== text) {
        oldInst.el.nodeValue = text
        oldInst.text = text
      }
      return oldInst
    }
    const next: TextInstance = {
      kind: 'text',
      text,
      el: document.createTextNode(text),
    }
    parentEl.replaceChild(next.el, oldInst.el)
    return next
  }
  if (oldInst.kind !== 'el' || oldInst.tag !== newChild.tag) {
    const next = materializeInstance(newChild)
    parentEl.replaceChild(next.el, oldInst.el)
    return next
  }
  patchProps(oldInst, newChild.props)
  oldInst.children = patchChildren(oldInst.el, oldInst.children, newChild.children)
  oldInst.props = newChild.props
  return oldInst
}

function patchProps(inst: ElInstance, newProps: Record<string, unknown>): void {
  const oldProps = inst.props
  // Drop attributes/listeners no longer present.
  for (const k of Object.keys(oldProps)) {
    if (k === 'key') continue
    if (k in newProps) continue
    const ev = matchEventProp(k)
    if (ev !== null) {
      const old = inst.handlers[ev]
      if (old) {
        inst.el.removeEventListener(ev, old)
        delete inst.handlers[ev]
      }
      continue
    }
    if (PROPERTY_PROPS.has(k)) {
      ;(inst.el as unknown as Record<string, unknown>)[k] = ''
    } else {
      inst.el.removeAttribute(k)
    }
  }
  for (const [k, v] of Object.entries(newProps)) {
    if (k === 'key') continue
    const ev = matchEventProp(k)
    if (ev !== null) {
      const old = inst.handlers[ev]
      if (typeof v === 'function') {
        if (old !== v) {
          if (old) inst.el.removeEventListener(ev, old)
          inst.el.addEventListener(ev, v as EventListener)
          inst.handlers[ev] = v as EventListener
        }
      } else if (old) {
        inst.el.removeEventListener(ev, old)
        delete inst.handlers[ev]
      }
      continue
    }
    if (v == null || v === false) {
      if (k in oldProps) {
        if (PROPERTY_PROPS.has(k)) {
          ;(inst.el as unknown as Record<string, unknown>)[k] = ''
        } else {
          inst.el.removeAttribute(k)
        }
      }
      continue
    }
    if (typeof v === 'function') continue // non-event function — ignored on DOM
    if (oldProps[k] === v) continue
    if (v === true) {
      inst.el.setAttribute(k, '')
      continue
    }
    if (PROPERTY_PROPS.has(k)) {
      ;(inst.el as unknown as Record<string, unknown>)[k] = v
    } else {
      inst.el.setAttribute(k, String(v))
    }
  }
}

/** `onClick` → `click`, `onInputChange` → `inputchange`. Returns null for non-event props. */
function matchEventProp(key: string): string | null {
  if (key.length < 3 || !key.startsWith('on')) return null
  const c = key.charCodeAt(2)
  // require an uppercase letter immediately after `on` to avoid catching e.g. `onion`
  if (c < 65 || c > 90) return null
  return key.slice(2).toLowerCase()
}
