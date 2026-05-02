import { Signal } from 'signal-polyfill'

export const VERSION = '0.0.0'

export { Signal }

export type Child = VNode | string | number | null | undefined | Child[]

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
  return renderVNode(node)
}

function renderVNode(node: VNode): string {
  // Static-HTML subtree (M6.0): the compiler already produced an HTML
  // string with attributes escaped + ClassRefs resolved, so SSR just
  // hands it back verbatim. No double-escape.
  if (node.tag === STATIC_TAG && node.html !== undefined) {
    return node.html
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
