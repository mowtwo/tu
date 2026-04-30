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
 * unsubscribes from cells AND removes the DOM nodes this mount created from
 * the container — so a host that swaps between mounts (e.g. the playground
 * sidebar) doesn't accumulate stale subtrees.
 *
 * Browser-only — requires `document`. Use `renderToString` for SSR.
 */
export function mount(thunk: () => Child, container: Element): () => void {
  let mounted: Instance[] = []
  const render = () => {
    mounted = patchChildren(container, mounted, [thunk()])
  }
  return startReactive(render, () => {
    for (const inst of mounted) {
      if (inst.el.parentNode === container) container.removeChild(inst.el)
    }
    mounted = []
  })
}

/**
 * One attribute → cell binding for `defineCustomElement`. The attribute's
 * string value (or `null` when removed) flows into `cell.set(...)` after
 * passing through the optional `parse`. Without `parse`, raw strings go
 * straight into the cell — so it's caller's job to use `parse: Number` /
 * `parse: (s) => s === ''` etc. for non-string types.
 */
export interface CustomElementAttribute {
  /** Any object exposing `.set(value)` — typically a `Signal.State`. */
  cell: { set(value: unknown): void }
  /** Convert the raw HTML attribute string into the cell's value type. */
  parse?: (raw: string | null) => unknown
}

export interface CustomElementOptions {
  /** Attribute → cell map. Keys become `observedAttributes`; the matching
   *  cell's `.set()` is called on initial connect AND on attribute change. */
  attributes?: Record<string, CustomElementAttribute>
}

/**
 * Wrap a Tu thunk in a custom-element class and register it under
 * `tagName`. The resulting element:
 *   - Applies any `attributes` bindings before the first mount, so the
 *     first render sees the user-provided attribute values.
 *   - Mounts the thunk on `connectedCallback` (re-renders reactively).
 *   - Re-applies a binding on every `attributeChangedCallback` — the
 *     reactive Watcher then patches the DOM via the standard diff path.
 *   - Tears down (`stop()`) on `disconnectedCallback`.
 *
 * V1 limitation: the thunk's reactive scope is the MODULE's top-level
 * cells. Multiple instances of the same registered element share state —
 * fine for singleton cases, limiting otherwise. Per-instance state
 * needs local-`let` support in Tu.
 *
 * Throws a `TypeError` outside a browser-like environment (no
 * `customElements`).
 */
export function defineCustomElement(
  thunk: () => Child,
  tagName: string,
  options: CustomElementOptions = {}
): void {
  if (typeof customElements === 'undefined') {
    throw new TypeError(
      `defineCustomElement requires a browser-like environment with customElements; got none`
    )
  }
  const attrs = options.attributes ?? {}
  const observed = Object.keys(attrs)
  const TuElement = class extends HTMLElement {
    static get observedAttributes(): string[] {
      return observed
    }
    private _stop?: () => void
    connectedCallback(): void {
      // Apply initial attribute values BEFORE mount so the first render
      // sees them — otherwise the thunk reads the cell's default and a
      // re-render is needed to catch up.
      for (const name of observed) {
        const binding = attrs[name]!
        const initial = this.getAttribute(name)
        binding.cell.set(binding.parse ? binding.parse(initial) : initial)
      }
      this._stop = mount(thunk, this)
    }
    disconnectedCallback(): void {
      this._stop?.()
      this._stop = undefined
    }
    attributeChangedCallback(
      name: string,
      _oldValue: string | null,
      newValue: string | null
    ): void {
      const binding = attrs[name]
      if (!binding) return
      binding.cell.set(binding.parse ? binding.parse(newValue) : newValue)
    }
  }
  customElements.define(tagName, TuElement)
}

/**
 * Adopt an SSR-rendered DOM tree under `container` and wire it up to a
 * reactive `thunk`. The first render does NOT create or move elements —
 * existing children are walked in lockstep with the thunk's first-frame
 * vnode tree, picking up event listeners and DOM-property props (which
 * SSR can't serialize) along the way. Subsequent renders use the normal
 * `patchChildren` diff.
 *
 * Whitespace-only text nodes between elements (incidental from pretty-
 * printed SSR HTML) are skipped during hydration. Structural mismatches —
 * a tag name that doesn't line up, a missing or extra node — fall back to
 * materializing the offending vnode from scratch and emit a `console.warn`
 * marker so the user knows their server output drifted from the client
 * thunk's first frame.
 *
 * Returns the same `stop()` shape as `mount()`.
 *
 * M4 V1 — pre-resumability hydration. A Qwik-style fully-resumable shape
 * (no client-side first-frame thunk re-execution) is deferred.
 */
export function hydrate(thunk: () => Child, container: Element): () => void {
  let mounted: Instance[] = []
  let firstRun = true
  const render = () => {
    if (firstRun) {
      firstRun = false
      const existing = Array.from(container.childNodes)
      mounted = hydrateChildren(container, [thunk()], existing)
      return
    }
    mounted = patchChildren(container, mounted, [thunk()])
  }
  return startReactive(render, () => {
    for (const inst of mounted) {
      if (inst.el.parentNode === container) container.removeChild(inst.el)
    }
    mounted = []
  })
}

/**
 * Shared reactive driver: wraps `render` in a Signal.Computed + Watcher,
 * pulls once for the initial run, and returns a stop closure that combines
 * the unwatch with whatever DOM cleanup the caller specifies.
 */
function startReactive(render: () => void, stop: () => void): () => void {
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
    stop()
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
 * Walk a list of pre-existing DOM nodes (the SSR output) under `parentEl`
 * in lockstep with a vnode list, producing Tu Instance objects that ADOPT
 * those existing DOM nodes — no `createElement` / `appendChild` for the
 * stable case. Listeners and DOM-property props (which SSR can't carry)
 * are applied during this walk.
 *
 * Whitespace-only text nodes are skipped (browsers parse pretty-printed
 * HTML with incidental text between tags). Structural mismatches log a
 * warning and fall back to materializing the offending vnode.
 */
function hydrateChildren(
  parentEl: Element,
  newRaw: Child[],
  initialNodes: readonly Node[]
): Instance[] {
  const newFlat = flatten(newRaw)
  const out: Instance[] = []
  // Mutable working list — supports splice for the text-node split case
  // (adjacent text vnodes that SSR coalesced into one DOM Text node).
  const nodes: Node[] = [...initialNodes]
  let i = 0

  for (const child of newFlat) {
    // Whitespace-only text nodes between elements are incidental SSR
    // formatting; only skip them when the vnode we're consuming is itself
    // an element (a text vnode might genuinely BE the whitespace).
    if (typeof child === 'object') {
      while (
        i < nodes.length &&
        nodes[i]!.nodeType === 3 /* TEXT_NODE */ &&
        isPureWhitespace(nodes[i]!.nodeValue ?? '')
      ) {
        i++
      }
    }
    const node = nodes[i]

    if (typeof child !== 'object') {
      const text = String(child)
      if (node && node.nodeType === 3 /* TEXT_NODE */) {
        const textNode = node as Text
        const existing = textNode.nodeValue ?? ''
        if (existing === text) {
          out.push({ kind: 'text', text, el: textNode })
        } else if (existing.startsWith(text)) {
          // SSR fused this text with the following sibling's text into one
          // Text node. Split: keep `text` in `textNode`, spawn a tail Text
          // node carrying the rest so the next iteration can claim it.
          textNode.nodeValue = text
          const tail = document.createTextNode(existing.slice(text.length))
          parentEl.insertBefore(tail, textNode.nextSibling)
          nodes.splice(i + 1, 0, tail)
          out.push({ kind: 'text', text, el: textNode })
        } else {
          warnHydrationMismatch(
            `text drift: ${JSON.stringify(truncate(existing))} vs ${JSON.stringify(truncate(text))}`
          )
          textNode.nodeValue = text
          out.push({ kind: 'text', text, el: textNode })
        }
        i++
      } else {
        warnHydrationMismatch(`expected text node, got ${describeNode(node)}`)
        const newText = document.createTextNode(text)
        if (node) parentEl.insertBefore(newText, node)
        else parentEl.appendChild(newText)
        nodes.splice(i, 0, newText)
        out.push({ kind: 'text', text, el: newText })
        i++
      }
      continue
    }

    if (
      node &&
      node.nodeType === 1 /* ELEMENT_NODE */ &&
      (node as Element).tagName.toLowerCase() === child.tag.toLowerCase()
    ) {
      out.push(hydrateElement(node as Element, child))
      i++
    } else {
      warnHydrationMismatch(`expected <${child.tag}>, got ${describeNode(node)}`)
      const inst = materializeInstance(child)
      if (node) parentEl.insertBefore(inst.el, node)
      else parentEl.appendChild(inst.el)
      nodes.splice(i, 0, inst.el)
      out.push(inst)
      i++
    }
  }

  // Drain remaining unclaimed nodes (skip whitespace; remove anything else).
  while (i < nodes.length) {
    const leftover = nodes[i]!
    if (
      leftover.nodeType === 3 &&
      isPureWhitespace(leftover.nodeValue ?? '')
    ) {
      i++
      continue
    }
    if (leftover.parentNode === parentEl) parentEl.removeChild(leftover)
    i++
  }

  return out
}

function truncate(s: string): string {
  return s.length > 40 ? s.slice(0, 40) + '…' : s
}

function hydrateElement(el: Element, child: VNode): ElInstance {
  const handlers: Record<string, EventListener> = {}
  for (const [k, v] of Object.entries(child.props)) {
    if (k === 'key') continue
    const ev = matchEventProp(k)
    if (ev !== null) {
      // Event handlers can't survive SSR — bind them now.
      if (typeof v === 'function') {
        el.addEventListener(ev, v as EventListener)
        handlers[ev] = v as EventListener
      }
      continue
    }
    if (PROPERTY_PROPS.has(k) && v != null && v !== false) {
      // SSR emits `value=`/`checked=` as attributes only; the live DOM
      // property still needs to be set (otherwise an input's `.value` is
      // empty string until the user types).
      ;(el as unknown as Record<string, unknown>)[k] = v
    }
    // All other props (class, id, data-*, etc.) are already in the DOM
    // via attributes from renderToString — leave them alone.
  }
  const childNodes = Array.from(el.childNodes)
  const grandchildren = hydrateChildren(el, child.children, childNodes)
  return {
    kind: 'el',
    tag: child.tag,
    props: child.props,
    el,
    children: grandchildren,
    handlers,
  }
}

function isPureWhitespace(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c !== 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) return false
  }
  return true
}

function describeNode(n: Node | undefined): string {
  if (!n) return 'no node'
  if (n.nodeType === 1) return `<${(n as Element).tagName.toLowerCase()}>`
  if (n.nodeType === 3) return 'text node'
  return `nodeType ${n.nodeType}`
}

function warnHydrationMismatch(msg: string): void {
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn(`[@tu/runtime] hydration mismatch: ${msg}`)
  }
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

  // Position pass — LIS-based: items that already form a longest-increasing
  // subsequence by old-index are stable (they don't need to move); only the
  // others get `insertBefore`. Walk right-to-left so each insertBefore uses
  // the next-stable instance as the anchor. Fresh instances (oi === -1) are
  // never in the LIS by construction, so they always get inserted.
  const lis = longestIncreasingSubseq(newToOld)
  let nextAnchor: Node | null = null
  for (let i = newInstances.length - 1; i >= 0; i--) {
    const inst = newInstances[i]!
    if (newToOld[i] === -1 || !lis.has(i)) {
      parentEl.insertBefore(inst.el, nextAnchor)
    }
    nextAnchor = inst.el
  }

  return newInstances
}

/**
 * Patience-sort LIS: given `newToOld` (where `-1` marks freshly-materialized
 * items that should never be considered stable), return the set of indices
 * `i` whose `newToOld[i]` participates in a longest increasing subsequence.
 *
 * Indices in the returned set are positions whose DOM element is already in
 * the correct relative order — patchChildren skips them in the position
 * pass. Everything else needs an `insertBefore`.
 *
 * Reference: https://en.wikipedia.org/wiki/Patience_sorting (the same
 * algorithm Vue 3 / Inferno use). O(n log n).
 */
function longestIncreasingSubseq(arr: readonly number[]): Set<number> {
  const n = arr.length
  if (n === 0) return new Set()
  // tails[k] = index in `arr` of the smallest possible tail of an increasing
  // subsequence of length k + 1. Stored as indices (not values) so we can
  // reconstruct the path via `prev`.
  const tails: number[] = []
  const prev: number[] = new Array(n).fill(-1)
  for (let i = 0; i < n; i++) {
    const x = arr[i]!
    if (x < 0) continue // fresh instance; never stable
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (arr[tails[mid]!]! < x) lo = mid + 1
      else hi = mid
    }
    if (lo > 0) prev[i] = tails[lo - 1]!
    tails[lo] = i
  }
  // Reconstruct the path back from the longest run's tail.
  const out = new Set<number>()
  let cur: number | undefined = tails[tails.length - 1]
  while (cur !== undefined && cur >= 0) {
    out.add(cur)
    const p = prev[cur]
    if (p === undefined || p < 0) break
    cur = p
  }
  return out
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
