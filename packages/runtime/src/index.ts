import { Signal } from 'signal-polyfill'

export const VERSION = '0.0.0'

export { Signal }

export type Child =
  | VNode
  | string
  | number
  | null
  | undefined
  | Child[]
  // M6.11 — async SSR (#60). A child may be a Promise resolving to another
  // Child shape. Sync `renderToString` throws on Promise children so callers
  // discover an accidentally-async component immediately rather than seeing
  // `[object Promise]` in the output. `renderToStringAsync` awaits the
  // promise and continues. `Suspense` (#61) uses this same shape for its
  // boundary children.
  | Promise<Child>

// Return type is `Promise<unknown>` (not `Promise<Child>`) because TS rejects
// `value is Promise<X>` when `X` references the promise type recursively (the
// `Child` union has `Promise<Child>` as a member). Callers `await` the value
// and feed the resolved shape back through the renderer, which re-narrows.
function isPromise(value: unknown): value is Promise<unknown> {
  return (
    value != null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

/**
 * Error thrown by sync `renderToString` when it encounters a Promise child —
 * the symptom of a Tu `async` component being rendered through the sync
 * path. The error names the offending tag (when knowable) so the fix is
 * obvious: switch the caller to `renderToStringAsync` / `renderPageAsync`.
 */
export class TuRenderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TuRenderError'
  }
}

export interface VNode {
  tag: string
  props: Record<string, unknown>
  children: Child[]
  /**
   * **Static-HTML subtree optimization (M6.0).** When the compiler proves a
   * markup subtree is fully static — no cell reads, no params, no
   * if/for/event handlers, no nested components — it skips emitting an
   * `h()` call per nested vnode and instead emits a single
   * `h("$static", {}, [], "<div>…</div>")`. The runtime then
   * `cloneNode`s the parsed template once on mount and serves the html
   * string verbatim during SSR. ClassRef hashes (M5/F dual-class
   * injection) are baked in at compile time, so scoped styles still
   * resolve correctly.
   *
   * MVP rules: present iff `tag === '$static'`; subtree must be a SINGLE
   * root element (no fragments). See packages/compiler/src/codegen.ts
   * `isStaticTree` for the precise predicate.
   */
  html?: string
}

/** Construct a virtual node. Compiled Tu emits calls to this. */
export function h(
  tag: string,
  props: Record<string, unknown> = {},
  children: Child[] = [],
  html?: string
): VNode {
  if (html !== undefined) return { tag, props, children, html }
  return { tag, props, children }
}

/** Tag sentinel used by the static-HTML optimization (M6.0). */
const STATIC_TAG = '$static'

/**
 * Tag sentinel for Suspense boundaries (M6.11 / #61). The boundary is a
 * vnode with `tag: '$suspense'`, `props.fallback` carrying the placeholder
 * Child, and `children` carrying the actual subtree.
 *
 * Behavior:
 * - `renderToStringAsync` walks `children`. If everything resolves, emits
 *   the body. If anything throws / rejects, catches at the boundary and
 *   emits `fallback` instead. Inner Suspense boundaries gate their own
 *   rejections so an outer boundary only sees a fallback string from the
 *   inner one (clean composition).
 * - Sync `renderToString` always emits `fallback`. The sync path can't
 *   await; if the body has no promises it's the user's bug to wrap it in
 *   Suspense at all (a sync subtree is just better off without). The
 *   sync emit lets callers like the playground render a Tu page that
 *   *contains* an async boundary without throwing.
 */
const SUSPENSE_TAG = '$suspense'

/**
 * Suspense boundary primitive (M6.11 / #61).
 *
 * Tu call-site:
 * ```tu
 * import { Suspense } from "@tu-lang/runtime"
 *
 * Suspense(fallback: div { "Loading…" }) {
 *   AsyncChild()
 * }
 * ```
 *
 * Compiles (M6.1 named-arg form) to:
 * ```js
 * Suspense({ fallback: h('div', {}, ['Loading…']), "children": [AsyncChild()] })
 * ```
 *
 * On the SSR async path, if `AsyncChild()` returns a Promise that resolves,
 * `renderToStringAsync` emits the resolved body; if it rejects, the
 * boundary catches and emits the fallback. Streaming SSR (#62) layers on
 * top, flushing fallback first and replacing it via `<template>` once the
 * body resolves.
 */
export function Suspense(props: {
  fallback: Child
  children?: Child[]
}): VNode {
  return {
    tag: SUSPENSE_TAG,
    props: { fallback: props.fallback },
    children: props.children ?? [],
  }
}

/**
 * Fragment helper for component bodies that want to return multiple
 * sibling vnodes without an enclosing wrapper element. Capitalized so it
 * goes through Tu's component-invocation path (M5 V1) — the codegen
 * emits `Fragment { a b c }` as `Fragment([a, b, c])`, and this function
 * just hands the array straight back to the renderer (whose flatten
 * step splices them into the parent's children list).
 *
 * Usage:
 *   ```tu
 *   import { Fragment } from "@tu-lang/runtime"
 *   let Layout = (children) => Fragment {
 *     header { "Title" }
 *     children
 *     footer { "Bottom" }
 *   }
 *   ```
 */
export function Fragment(children: Child[]): Child {
  return children
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
  if (isPromise(node)) {
    throw new TuRenderError(
      'renderToString hit a Promise child — an async component was rendered ' +
      'through the sync path. Switch the caller to `renderToStringAsync` / ' +
      '`renderPageAsync`, or wrap the boundary in <Suspense>.'
    )
  }
  return renderVNode(node)
}

function renderVNode(node: VNode): string {
  // Static-HTML subtree (M6.0): the compiler already produced an HTML
  // string with attributes escaped + ClassRefs resolved, so SSR just
  // hands it back verbatim. No double-escape.
  if (node.tag === STATIC_TAG && node.html !== undefined) {
    return node.html
  }
  // Suspense boundary (#61): sync path can't await — emit the fallback
  // verbatim. (If the body has no promises the user shouldn't be wrapping
  // it in Suspense anyway.) The async path handles resolution properly.
  if (node.tag === SUSPENSE_TAG) {
    return renderToString((node.props.fallback as Child) ?? null)
  }
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

/**
 * Server-rendered full HTML document (M6.2). Wraps `thunk()`'s rendered
 * output in `<!doctype html><html><head>…</head><body>…</body></html>`,
 * injecting head metadata, stylesheets, and scripts so the result is
 * a complete, browser-ready page — the foundation for tu-shu and any
 * other Tu-built static site or SSR server.
 *
 * The function is sync (Tu has no async story yet); for streaming or
 * Suspense-style data prefetching, see the deferred backlog.
 *
 * Example:
 *   ```ts
 *   const html = renderPage(() => App(), {
 *     lang: 'en',
 *     title: 'My Tu App',
 *     meta: { description: 'A reactive UI built with Tu' },
 *     links: [{ rel: 'stylesheet', href: '/assets/app.css' }],
 *     scripts: [{ src: '/assets/client.js', type: 'module' }],
 *   })
 *   ```
 */
export interface RenderPageOptions {
  /** `<html lang="…">`. Defaults to `'en'`. */
  lang?: string
  /** `<title>` text. Defaults to omitting the tag. */
  title?: string
  /** `<meta name=k content=v>` entries. `charset` and `viewport` are
   *  emitted by default and can be overridden via this map. */
  meta?: Record<string, string>
  /** `<link>` entries — stylesheets, icons, preloads. */
  links?: Array<Record<string, string>>
  /** `<script>` entries — most commonly the client hydration entry. */
  scripts?: Array<{
    src?: string
    type?: 'module' | 'text/javascript' | 'importmap'
    defer?: boolean
    async?: boolean
    /** Inline script body (mutually exclusive with `src`). */
    body?: string
  }>
  /** Extra raw HTML to splice into `<head>` after the auto-generated
   *  bits. Use for OpenGraph cards, Tailwind injection, etc. */
  headRaw?: string
  /** `<body class="…">`. */
  bodyClass?: string
  /** Inline script appended right after the app body — useful for
   *  "state hydration" payloads (`window.__INITIAL__ = …`). The string
   *  is inserted verbatim; callers must JSON-stringify their data. */
  inlineScript?: string
}

export function renderPage(thunk: () => Child, options: RenderPageOptions = {}): string {
  const body = renderToString(thunk())
  return assemblePage(body, options)
}

/**
 * Same as `renderPage` but takes already-rendered `bodyHtml`. Useful when
 * the caller wants to keep separate hooks before/after thunk invocation
 * (route guards, data prefetch) — they call `renderToString(thunk())` on
 * their own and pipe the result here.
 */
export function renderPageHtml(bodyHtml: string, options: RenderPageOptions = {}): string {
  return assemblePage(bodyHtml, options)
}

/**
 * Async counterpart to `renderToString` (M6.11 / #60). Awaits any Promise
 * child it encounters and continues the walk. Sibling subtrees inside an
 * array — including the implicit array of children on every vnode — resolve
 * in parallel via `Promise.all`, so two independent `await fetch(...)` calls
 * don't serialize.
 *
 * The static-HTML fast path (`tag === '$static'`, M6.0) stays sync because
 * `isStaticTree` (in the compiler) excludes any subtree containing component
 * invocations — so by construction a `$static` body holds no promises.
 *
 * Suspense boundaries (#61) participate via the dedicated `$suspense` tag
 * branch; #60 leaves that branch as a passthrough so this function ships
 * standalone before the boundary primitive lands.
 */
export async function renderToStringAsync(node: Child): Promise<string> {
  if (node == null) return ''
  if (typeof node === 'string') return escapeText(node)
  if (typeof node === 'number') return String(node)
  if (isPromise(node)) {
    // Cast through Child — the promise's fulfillment type is `unknown`
    // because `isPromise` returns `Promise<unknown>` (TS forbids the
    // recursive `Promise<Child>` shape in a type-guard return). At
    // runtime the resolved value is whatever the user produced; if it's
    // not a valid Child the recursive `renderToStringAsync` call will
    // fall through to `renderVNodeAsync` and crash on a missing `.tag`,
    // which is the same outcome as a sync renderToString seeing junk.
    const resolved = (await (node as Promise<unknown>)) as Child
    return renderToStringAsync(resolved)
  }
  if (Array.isArray(node)) {
    const parts = await Promise.all(node.map((c) => renderToStringAsync(c)))
    return parts.join('')
  }
  return renderVNodeAsync(node)
}

async function renderVNodeAsync(node: VNode): Promise<string> {
  if (node.tag === STATIC_TAG && node.html !== undefined) {
    return node.html
  }
  // Suspense boundary (#61): try to render the body. If anything inside
  // throws or any awaited promise rejects, fall back to the fallback
  // Child instead. Boundaries compose: an inner Suspense's catch emits
  // its own fallback string, so the outer boundary never sees the
  // rejection.
  if (node.tag === SUSPENSE_TAG) {
    const fallback = (node.props.fallback as Child) ?? null
    try {
      const parts = await Promise.all(
        node.children.map((c) => renderToStringAsync(c))
      )
      return parts.join('')
    } catch {
      return renderToStringAsync(fallback)
    }
  }
  let propStr = ''
  for (const [k, v] of Object.entries(node.props)) {
    if (k === 'key') continue
    if (v == null || v === false) continue
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
    for (const c of node.children) {
      childStr += await renderRawTextChildAsync(c)
    }
  } else {
    const parts = await Promise.all(
      node.children.map((c) => renderToStringAsync(c))
    )
    childStr = parts.join('')
  }
  return `<${node.tag}${propStr}>${childStr}</${node.tag}>`
}

async function renderRawTextChildAsync(node: Child): Promise<string> {
  if (node == null) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (isPromise(node)) {
    const resolved = (await (node as Promise<unknown>)) as Child
    return renderRawTextChildAsync(resolved)
  }
  if (Array.isArray(node)) {
    const parts = await Promise.all(node.map((c) => renderRawTextChildAsync(c)))
    return parts.join('')
  }
  return renderVNodeAsync(node)
}

/**
 * Async counterpart to `renderPage`. The thunk itself may be async — Tu's
 * `let Page = async () => …` compiles to an async lambda, so calling it
 * returns a Promise. The body is rendered via `renderToStringAsync` and
 * then assembled into the same `<!doctype html>…</html>` shell as the
 * sync flavor.
 */
export async function renderPageAsync(
  thunk: () => Child | Promise<Child>,
  options: RenderPageOptions = {}
): Promise<string> {
  const result = thunk()
  const root = (isPromise(result)
    ? ((await (result as Promise<unknown>)) as Child)
    : (result as Child))
  const body = await renderToStringAsync(root)
  return assemblePage(body, options)
}

function assemblePage(bodyHtml: string, options: RenderPageOptions): string {
  const lang = options.lang ?? 'en'
  const meta = {
    charset: 'utf-8',
    viewport: 'width=device-width, initial-scale=1.0',
    ...(options.meta ?? {}),
  }
  let head = ''
  // <meta charset> is special-cased — uses `charset` attribute, not name.
  if (meta.charset) {
    head += `<meta charset="${escapeAttr(meta.charset)}">`
  }
  for (const [k, v] of Object.entries(meta)) {
    if (k === 'charset') continue
    head += `<meta name="${escapeAttr(k)}" content="${escapeAttr(v)}">`
  }
  if (options.title) head += `<title>${escapeText(options.title)}</title>`
  for (const link of options.links ?? []) {
    head += '<link'
    for (const [k, v] of Object.entries(link)) head += ` ${k}="${escapeAttr(v)}"`
    head += '>'
  }
  for (const s of options.scripts ?? []) {
    head += '<script'
    if (s.type) head += ` type="${escapeAttr(s.type)}"`
    if (s.src) head += ` src="${escapeAttr(s.src)}"`
    if (s.defer) head += ' defer'
    if (s.async) head += ' async'
    head += '>'
    if (s.body) head += s.body // raw — caller controls escaping
    head += '</script>'
  }
  if (options.headRaw) head += options.headRaw
  const bodyClassAttr = options.bodyClass ? ` class="${escapeAttr(options.bodyClass)}"` : ''
  const tail = options.inlineScript
    ? `<script>${options.inlineScript}</script>`
    : ''
  return `<!doctype html><html lang="${escapeAttr(lang)}"><head>${head}</head><body${bodyClassAttr}>${bodyHtml}${tail}</body></html>`
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
  if (isPromise(node)) {
    throw new TuRenderError(
      'renderToString hit a Promise child inside a raw-text element ' +
      '(<style> / <script>). Switch the caller to `renderToStringAsync`.'
    )
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
