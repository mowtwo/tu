export const VERSION = '0.0.0'

export { Signal } from 'signal-polyfill'

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
  for (const c of node.children) {
    childStr += renderToString(c)
  }
  return `<${node.tag}${propStr}>${childStr}</${node.tag}>`
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
