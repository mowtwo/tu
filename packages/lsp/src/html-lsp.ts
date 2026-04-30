// HTML language-service integration. Tu's tag-call DSL renders into
// `h("div", …)` / `h("h1", …)` / etc., so the LSP needs to surface
// MDN-quality docs on hover and on completion. This module wraps
// `vscode-html-languageservice`'s data provider — same family as
// `vscode-css-languageservice` already used for the `style { … }` block.
//
// Implementation note: we don't run the HTML language service over a
// synthetic `<…>` document — Tu's grammar is its own and the AST already
// gives us the tag span. We just consume the static tag-data tables.
import { parse, tokenize, type Program, type TagCall } from '@tu-ui/compiler'
import {
  getDefaultHTMLDataProvider,
  type IHTMLDataProvider,
  type ITagData,
  type IAttributeData,
} from 'vscode-html-languageservice'

let provider: IHTMLDataProvider | null = null
function getProvider(): IHTMLDataProvider {
  if (!provider) provider = getDefaultHTMLDataProvider()
  return provider
}

let tagIndex: Map<string, ITagData> | null = null
function getTagIndex(): Map<string, ITagData> {
  if (!tagIndex) {
    const m = new Map<string, ITagData>()
    for (const t of getProvider().provideTags()) m.set(t.name.toLowerCase(), t)
    tagIndex = m
  }
  return tagIndex
}

/** Every HTML tag name the data provider knows about, lowercase. Used by
 *  completion to populate the expression-head HTML tag list. */
export function htmlTagNames(): string[] {
  return [...getTagIndex().keys()].sort()
}

/** Look up a tag's structured metadata (description + MDN references)
 *  for hover / completion. Returns null when the tag isn't in the
 *  standard HTML set (Tu allows arbitrary tag names — Web Components,
 *  custom elements — so a lookup miss isn't an error). */
export function htmlTagInfo(tag: string): ITagData | null {
  return getTagIndex().get(tag.toLowerCase()) ?? null
}

/**
 * Render a tag's metadata as Markdown — the body of a hover or the
 * `documentation` field of a completion item. Mirrors the layout
 * vscode-html-languageservice uses internally for HTML hover.
 */
export function renderHtmlTagDocs(tag: string): string | null {
  const info = htmlTagInfo(tag)
  if (!info) return null
  const lines: string[] = []
  lines.push(`**\`<${info.name}>\`**`)
  lines.push('')
  if (typeof info.description === 'string') {
    lines.push(info.description)
  } else if (info.description && typeof info.description === 'object') {
    const v = (info.description as { value?: string }).value
    if (v) lines.push(v)
  }
  if (info.references && info.references.length > 0) {
    lines.push('')
    for (const ref of info.references) {
      lines.push(`[${ref.name}](${ref.url})`)
    }
  }
  return lines.join('\n')
}

/** Render an attribute's metadata as Markdown (for completion popup). */
export function renderHtmlAttrDocs(tag: string, attr: string): string | null {
  const info = htmlTagInfo(tag)
  if (!info) return null
  const a = info.attributes.find((x) => x.name === attr.toLowerCase())
  if (!a) return null
  return renderAttr(a)
}

function renderAttr(a: IAttributeData): string {
  const lines: string[] = []
  lines.push(`**\`${a.name}\`**`)
  if (typeof a.description === 'string') {
    lines.push('')
    lines.push(a.description)
  } else if (a.description && typeof a.description === 'object') {
    const v = (a.description as { value?: string }).value
    if (v) {
      lines.push('')
      lines.push(v)
    }
  }
  if (a.references && a.references.length > 0) {
    lines.push('')
    for (const ref of a.references) lines.push(`[${ref.name}](${ref.url})`)
  }
  return lines.join('\n')
}

/**
 * Find the TagCall AST node whose tag identifier covers `offset`. Returns
 * the tag name + its byte range so the hover layer can map back to a
 * `(line, col, length)` tuple. Walks the whole program — tag-calls can
 * nest arbitrarily inside lambdas, blocks, ifs, fors, components.
 */
export function findTagCallAt(
  source: string,
  offset: number
): { tag: string; start: number; end: number } | null {
  let program: Program
  try {
    program = parse(tokenize(source), source)
  } catch {
    return null
  }
  let hit: TagCall | null = null
  for (const stmt of program.body) {
    if (stmt.kind !== 'LetDecl') continue
    walkTagCalls(stmt.value, (t) => {
      if (offset >= t.tagStart && offset < t.tagEnd) hit = t
    })
    if (hit) break
  }
  if (!hit) return null
  const tagCall = hit as TagCall
  return { tag: tagCall.tag, start: tagCall.tagStart, end: tagCall.tagEnd }
}

function walkTagCalls(
  expr: { kind: string } | undefined,
  hit: (t: TagCall) => void
): void {
  if (!expr) return
  const e = expr as Record<string, unknown>
  switch (expr.kind) {
    case 'TagCall': {
      const t = expr as unknown as TagCall
      hit(t)
      for (const p of t.props) walkTagCalls(p.value as { kind: string }, hit)
      for (const c of t.children) walkTagCalls(c as { kind: string }, hit)
      return
    }
    case 'Lambda':
      walkTagCalls(e.body as { kind: string }, hit)
      return
    case 'Block':
      for (const c of e.body as { kind: string }[]) walkTagCalls(c, hit)
      return
    case 'IfExpr':
      walkTagCalls(e.cond as { kind: string }, hit)
      walkTagCalls(e.then as { kind: string }, hit)
      if (e.else) walkTagCalls(e.else as { kind: string }, hit)
      return
    case 'ForExpr':
      walkTagCalls(e.iter as { kind: string }, hit)
      walkTagCalls(e.body as { kind: string }, hit)
      return
    case 'ArrayLit':
      for (const c of e.elements as { kind: string }[]) walkTagCalls(c, hit)
      return
    case 'ObjectLit':
      for (const p of e.properties as { value: { kind: string } }[]) walkTagCalls(p.value, hit)
      return
    case 'CallExpr':
      for (const a of e.args as { kind: string }[]) walkTagCalls(a, hit)
      if (Array.isArray(e.children)) {
        for (const c of e.children as { kind: string }[]) walkTagCalls(c, hit)
      }
      return
    case 'BinaryExpr':
      walkTagCalls(e.left as { kind: string }, hit)
      walkTagCalls(e.right as { kind: string }, hit)
      return
    case 'AssignExpr':
      walkTagCalls(e.value as { kind: string }, hit)
      return
    case 'MemberExpr':
      walkTagCalls(e.object as { kind: string }, hit)
      return
    default:
      return
  }
}
