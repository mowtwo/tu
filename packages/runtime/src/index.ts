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
// it reads becomes stale. M1.5 uses a naive replace-children diff: every cell
// change blows the container's children away and rebuilds. Keyed diffing is
// future work.

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
  const render = () => {
    while (container.firstChild) container.removeChild(container.firstChild)
    appendChildTo(container, thunk())
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

function appendChildTo(parent: Node, child: Child): void {
  if (child == null) return
  if (typeof child === 'string') {
    parent.appendChild(document.createTextNode(child))
    return
  }
  if (typeof child === 'number') {
    parent.appendChild(document.createTextNode(String(child)))
    return
  }
  if (Array.isArray(child)) {
    for (const c of child) appendChildTo(parent, c)
    return
  }
  parent.appendChild(materialize(child))
}

function materialize(node: VNode): Element {
  const el = document.createElement(node.tag)
  for (const [k, v] of Object.entries(node.props)) {
    if (v == null || v === false) continue
    const eventName = matchEventProp(k)
    if (eventName !== null) {
      if (typeof v === 'function') {
        el.addEventListener(eventName, v as EventListener)
      }
      continue
    }
    if (v === true) {
      el.setAttribute(k, '')
      continue
    }
    if (typeof v === 'function') continue // non-event function prop has no DOM mapping
    el.setAttribute(k, String(v))
  }
  for (const c of node.children) appendChildTo(el, c)
  return el
}

/** `onClick` → `click`, `onInputChange` → `inputchange`. Returns null for non-event props. */
function matchEventProp(key: string): string | null {
  if (key.length < 3 || !key.startsWith('on')) return null
  const c = key.charCodeAt(2)
  // require an uppercase letter immediately after `on` to avoid catching e.g. `onion`
  if (c < 65 || c > 90) return null
  return key.slice(2).toLowerCase()
}
