// `@tu-lang/dom` — the explicit opt-in to the DOM platform.
//
// Tu's compiler auto-imports the universal half of the runtime
// (`Signal`, `h`, `Fragment`, `VNode`, `Child`, `renderToString`, …) from
// `@tu-lang/runtime`. Anything that touches `document` / `Element` /
// `Event` / `customElements` lives here, behind an explicit
// `import { … } from "@tu-lang/dom"` so a Tu program that doesn't intend
// to run in a browser can never accidentally call `document.x`.
//
// What this module provides:
//   - `mount(thunk, container)` — the standard reactive mount entry.
//   - `hydrate(thunk, container)` — adopt SSR DOM in place.
//   - `defineCustomElement(thunk, tag, options)` — Tu component →
//     <my-tag> custom element.
//   - Typed re-exports of the DOM globals + types most user code
//     reaches for (`document`, `window`, `Event`, `HTMLElement`,
//     `MouseEvent`, `KeyboardEvent`, `InputEvent`, `Element`, `Node`,
//     `Text`, `EventListener`, etc.). These let Tu users import what
//     they need by name — no ambient lib leakage.
//
// The runtime patch path ALSO lives here because it's coupled to the
// DOM (createElement / setAttribute / addEventListener), but the wire
// types it touches (`Child`, `VNode`) come from `@tu-lang/runtime` so
// SSR (`renderToString`) and DOM (`mount`/`hydrate`) operate on the
// same shape.

import {
  Signal,
  normalizeClassValue,
  normalizeStyleValue,
  type Child,
  type VNode,
} from '@tu-lang/runtime'

// ── DOM type re-exports (typed access for Tu user code) ────────────
//
// We deliberately do NOT re-export `document` / `window` as values.
// User Tu code that wants to touch them directly should drop into an
// `external JS` block — that's the explicit "I'm in DOM territory"
// signal Tu's design wants. Everything routine (mount / hydrate /
// custom elements + standard DOM types) is available through this
// module's typed surface.
//
// Local type aliases over the global DOM types. TS forbids re-exporting
// ambient globals via `export type { X }`, so we surface each one through
// an explicit alias instead. Users still write `import { Event } from
// "@tu-lang/dom"` — the binding is just a type alias under the hood.
export type Element = globalThis.Element
export type HTMLElement = globalThis.HTMLElement
export type HTMLInputElement = globalThis.HTMLInputElement
export type HTMLButtonElement = globalThis.HTMLButtonElement
export type HTMLAnchorElement = globalThis.HTMLAnchorElement
export type HTMLImageElement = globalThis.HTMLImageElement
export type HTMLFormElement = globalThis.HTMLFormElement
export type HTMLTextAreaElement = globalThis.HTMLTextAreaElement
export type HTMLSelectElement = globalThis.HTMLSelectElement
export type HTMLOptionElement = globalThis.HTMLOptionElement
export type HTMLDivElement = globalThis.HTMLDivElement
export type HTMLSpanElement = globalThis.HTMLSpanElement
export type HTMLLabelElement = globalThis.HTMLLabelElement
export type HTMLIFrameElement = globalThis.HTMLIFrameElement
export type HTMLCanvasElement = globalThis.HTMLCanvasElement
export type HTMLVideoElement = globalThis.HTMLVideoElement
export type HTMLAudioElement = globalThis.HTMLAudioElement
export type HTMLTableElement = globalThis.HTMLTableElement
export type HTMLTableRowElement = globalThis.HTMLTableRowElement
export type HTMLTableCellElement = globalThis.HTMLTableCellElement
export type Node = globalThis.Node
export type Text = globalThis.Text
export type Document = globalThis.Document
export type Window = globalThis.Window
export type EventTarget = globalThis.EventTarget
// Events
export type Event = globalThis.Event
export type UIEvent = globalThis.UIEvent
export type MouseEvent = globalThis.MouseEvent
export type KeyboardEvent = globalThis.KeyboardEvent
export type InputEvent = globalThis.InputEvent
export type PointerEvent = globalThis.PointerEvent
export type TouchEvent = globalThis.TouchEvent
export type WheelEvent = globalThis.WheelEvent
export type FocusEvent = globalThis.FocusEvent
export type DragEvent = globalThis.DragEvent
export type ClipboardEvent = globalThis.ClipboardEvent
export type CustomEvent<T = unknown> = globalThis.CustomEvent<T>
export type EventListener = globalThis.EventListener
export type EventListenerObject = globalThis.EventListenerObject
export type EventListenerOrEventListenerObject = globalThis.EventListenerOrEventListenerObject
export type AddEventListenerOptions = globalThis.AddEventListenerOptions
// Net + storage
export type RequestInit = globalThis.RequestInit
export type Response = globalThis.Response
export type Headers = globalThis.Headers
export type FormData = globalThis.FormData
export type URLSearchParams = globalThis.URLSearchParams
export type AbortController = globalThis.AbortController
export type AbortSignal = globalThis.AbortSignal

// ── Static-HTML subtree sentinel ──────────────────────────────────
//
// Mirrors the constant in @tu-lang/runtime's renderToString path. The
// codegen emits `h("$static", {}, [], "<div>…</div>")` for fully static
// subtrees; the runtime adopts the html via `<template>.innerHTML` once
// per mount (see materializeInstance).
const STATIC_TAG = '$static'

// ── Internal instance shapes (DOM-side only) ──────────────────────

type NormalizedChild = VNode | string | number | boolean | bigint

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

/**
 * Static-HTML subtree (M6.0). Created from `h("$static", {}, [], html)`.
 * The runtime parses `html` once via `<template>.innerHTML` and adopts the
 * single resulting root element. Subsequent renders that emit the same
 * static vnode reuse the existing `el` (the html string is keyed by the
 * compile-time output, so equality is the only check the runtime needs).
 */
interface StaticInstance {
  kind: 'static'
  html: string
  el: Element
}

type Instance = ElInstance | TextInstance | StaticInstance

/**
 * Properties that must be set as DOM properties rather than HTML attributes
 * — assigning to `.value` updates an input live, while `setAttribute('value', …)`
 * only sets the initial value.
 */
const PROPERTY_PROPS = new Set(['value', 'checked', 'selected'])

// ── Public entry points ───────────────────────────────────────────

/**
 * Mount a reactive component into a DOM container.
 *
 * `thunk` is invoked once on mount and again, scheduled via microtask, every
 * time any Signal it reads becomes stale. Returns a `stop()` function that
 * unsubscribes from cells AND removes the DOM nodes this mount created from
 * the container — so a host that swaps between mounts (e.g. the playground
 * sidebar) doesn't accumulate stale subtrees.
 *
 * Browser-only — requires `document`. Use `renderToString` (from
 * `@tu-lang/runtime`) for SSR.
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

// ── Reactive driver + diff path (DOM-coupled) ─────────────────────

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
  if (typeof c === 'number' || typeof c === 'boolean' || typeof c === 'bigint') {
    out.push(c)
    return
  }
  if (Array.isArray(c)) {
    for (const cc of c) flattenInto(out, cc)
    return
  }
  // Promise children are valid in @tu-lang/runtime's async SSR path
  // (M6.11 / #60), but mount/hydrate run synchronously and have no
  // reactive scheduling for an unresolved promise yet — that's CSR
  // Suspense, separate work. Surface a typed error so the caller knows
  // the offending shape; the message points to the right escape hatch.
  if (
    c != null &&
    (typeof c === 'object' || typeof c === 'function') &&
    typeof (c as { then?: unknown }).then === 'function'
  ) {
    throw new Error(
      '[@tu-lang/dom] mount/hydrate hit a Promise child — async ' +
      'components on the client are not yet supported. Pre-render via ' +
      'renderToStringAsync (SSR) or wrap the boundary in <Suspense>.'
    )
  }
  out.push(c as VNode)
}

function materializeInstance(child: NormalizedChild): Instance {
  if (typeof child !== 'object') {
    const text = String(child)
    return { kind: 'text', text, el: document.createTextNode(text) }
  }
  // Static-HTML subtree (M6.0): parse once via `<template>` (correctly
  // handles fragment-context elements like <tr>, <td>, <option> that a
  // <div> wrapper would mis-parse) and adopt the single root element.
  if (child.tag === STATIC_TAG && child.html !== undefined) {
    const tpl = document.createElement('template')
    tpl.innerHTML = child.html
    const el = tpl.content.firstElementChild
    if (!el) {
      // Empty html string (shouldn't happen — codegen always produces at
      // least one element). Fall back to an empty <div> placeholder so the
      // mount path doesn't crash.
      return {
        kind: 'static',
        html: child.html,
        el: document.createElement('div'),
      }
    }
    return { kind: 'static', html: child.html, el: el as Element }
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
    } else if (k === 'class') {
      const s = normalizeClassValue(v)
      if (s) el.setAttribute('class', s)
    } else if (k === 'style') {
      const s = normalizeStyleValue(v)
      if (s) el.setAttribute('style', s)
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

    // Static-HTML subtree (M6.0). SSR emitted the html verbatim, so the
    // existing DOM element at this position IS the static subtree's root.
    // We don't walk inside it — by construction it's fully static.
    if (child.tag === STATIC_TAG && child.html !== undefined) {
      if (node && node.nodeType === 1) {
        out.push({
          kind: 'static',
          html: child.html,
          el: node as Element,
        })
        i++
        continue
      }
      warnHydrationMismatch(`expected static element, got ${describeNode(node)}`)
      const inst = materializeInstance(child)
      if (node) parentEl.insertBefore(inst.el, node)
      else parentEl.appendChild(inst.el)
      nodes.splice(i, 0, inst.el)
      out.push(inst)
      i++
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
    console.warn(`[@tu-lang/dom] hydration mismatch: ${msg}`)
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
  // Static-HTML subtree (M6.0). The compile-time html string is the
  // identity key — same string means same DOM, no patching needed.
  // Different string (rare; static subtrees usually keep their compiled
  // shape forever) → re-materialize and replace.
  if (newChild.tag === STATIC_TAG && newChild.html !== undefined) {
    if (oldInst.kind === 'static' && oldInst.html === newChild.html) {
      return oldInst
    }
    const next = materializeInstance(newChild)
    parentEl.replaceChild(next.el, oldInst.el)
    return next
  }
  // Crossing in/out of $static: always replace.
  if (oldInst.kind === 'static') {
    const next = materializeInstance(newChild)
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
    } else if (k === 'class') {
      const s = normalizeClassValue(v)
      if (s) inst.el.setAttribute('class', s)
      else inst.el.removeAttribute('class')
    } else if (k === 'style') {
      const s = normalizeStyleValue(v)
      if (s) inst.el.setAttribute('style', s)
      else inst.el.removeAttribute('style')
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
