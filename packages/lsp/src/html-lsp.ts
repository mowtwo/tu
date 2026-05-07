// HTML language-service integration. Tu's tag-call DSL renders into
// `h("div", …)` / `h("h1", …)` / etc., so the LSP needs to surface
// MDN-quality docs on hover and on completion. This module wraps
// `vscode-html-languageservice`'s data provider — same family as
// `vscode-css-languageservice` already used for the `style { … }` block.
//
// Implementation note: we don't run the HTML language service over a
// synthetic `<…>` document — Tu's grammar is its own and the AST already
// gives us the tag span. We just consume the static tag-data tables.
import { parse, tokenize, type Program, type TagCall } from '@tu-lang/compiler'
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

/**
 * Render an attribute's metadata as Markdown (for completion popup or
 * hover). `provideAttributes(tag)` from vscode-html-languageservice
 * returns the FULL attribute set valid for `tag` — both tag-specific
 * and global (`class`, `id`, `style`, `data-*`, ARIA, `on*` events).
 * Falling back to a generic `'div'` lookup catches the case when `tag`
 * is unknown (a Web Component or custom element) so global attributes
 * still render docs.
 */
export function renderHtmlAttrDocs(tag: string, attr: string): string | null {
  const lc = attr.toLowerCase()
  const provider = getProvider()
  const tagAttrs = provider.provideAttributes(tag.toLowerCase())
  let a = tagAttrs.find((x) => x.name === lc)
  if (!a) {
    // Fall back to div's table (which carries global attrs) when tag
    // is unknown.
    a = provider.provideAttributes('div').find((x) => x.name === lc)
  }
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
      // Inclusive end so a cursor at the trailing edge still hits —
      // VS Code typically sends col = token's end column when
      // hovering on the last char.
      if (offset >= t.tagStart && offset <= t.tagEnd) hit = t
    })
    if (hit) break
  }
  if (!hit) return null
  const tagCall = hit as TagCall
  return { tag: tagCall.tag, start: tagCall.tagStart, end: tagCall.tagEnd }
}

/**
 * Find an HTML-attribute hit: the TagCall + attr name whose source
 * range covers `offset`. Returns null when the cursor isn't on a prop
 * name (or the surrounding TagCall couldn't be resolved).
 *
 * Used by hover to surface MDN attribute docs when the cursor sits on
 * `class`, `onClick`, `href`, etc. inside a tag-call's prop list.
 */
export function findAttrAt(
  source: string,
  offset: number
): { tag: string; attr: string; start: number; end: number } | null {
  let program: Program
  try {
    program = parse(tokenize(source), source)
  } catch {
    return null
  }
  let hitTag: TagCall | null = null
  let hitAttrStart = -1
  let hitAttrEnd = -1
  let hitAttrName = ''
  for (const stmt of program.body) {
    if (stmt.kind !== 'LetDecl') continue
    walkTagCalls(stmt.value, (t) => {
      for (const p of t.props) {
        if (p.nameStart === undefined || p.nameEnd === undefined) continue
        if (offset >= p.nameStart && offset <= p.nameEnd) {
          hitTag = t
          hitAttrStart = p.nameStart
          hitAttrEnd = p.nameEnd
          hitAttrName = p.name
        }
      }
    })
    if (hitTag) break
  }
  if (!hitTag) return null
  const tagCall = hitTag as TagCall
  return {
    tag: tagCall.tag,
    attr: hitAttrName,
    start: hitAttrStart,
    end: hitAttrEnd,
  }
}

function walkTagCalls(
  expr: { kind: string } | undefined,
  hit: (t: TagCall) => void
): void {
  if (!expr) return
  const e = expr as Record<string, unknown>
  const visit = (node: unknown) => walkTagCalls(node as { kind: string }, hit)
  switch (expr.kind) {
    case 'TagCall': {
      const t = expr as unknown as TagCall
      hit(t)
      for (const p of t.props) visit(p.value)
      for (const c of t.children) visit(c)
      return
    }
    case 'Lambda':
      visit(e.body)
      return
    case 'Block':
      for (const c of e.body as { kind: string }[]) visit(c)
      return
    case 'LocalLet':
      visit(e.value)
      return
    case 'IfExpr':
      visit(e.cond)
      visit(e.then)
      if (e.else) visit(e.else)
      return
    case 'ForExpr':
      visit(e.iter)
      visit(e.body)
      return
    case 'ArrayLit':
      for (const c of e.elements as unknown[]) visit(c)
      return
    case 'ObjectLit':
      // ObjectLit's `properties` items are either `ObjectProp` (key+value)
      // or `ObjectSpread` (kind: 'ObjectSpread', arg). Walk both.
      for (const p of e.properties as Array<Record<string, unknown>>) {
        if (p.kind === 'ObjectSpread') visit(p.arg)
        else {
          if (p.computedKey) visit(p.computedKey)
          visit(p.value)
        }
      }
      return
    case 'CallExpr':
      for (const a of e.args as unknown[]) visit(a)
      if (Array.isArray(e.children)) for (const c of e.children) visit(c)
      if (Array.isArray(e.namedArgs)) {
        for (const p of e.namedArgs as Array<Record<string, unknown>>) visit(p.value)
      }
      return
    case 'MethodCallExpr':
      visit(e.object)
      for (const a of e.args as unknown[]) visit(a)
      return
    case 'InvokeExpr':
      visit(e.callee)
      for (const a of e.args as unknown[]) visit(a)
      return
    case 'BinaryExpr':
      visit(e.left)
      visit(e.right)
      return
    case 'TernaryExpr':
      visit(e.cond)
      visit(e.then)
      visit(e.else)
      return
    case 'AssignExpr':
      visit(e.value)
      return
    case 'MemberAssignExpr':
      visit(e.target)
      visit(e.value)
      return
    case 'MemberExpr':
      visit(e.object)
      return
    case 'IndexExpr':
      visit(e.object)
      visit(e.index)
      return
    case 'UnaryExpr':
    case 'NonNullAssertExpr':
    case 'AsExpr':
    case 'NewExpr':
    case 'UpdateExpr':
    case 'AwaitExpr':
    case 'ImportExpr':
    case 'ThrowExpr':
    case 'SpreadElement':
      visit(e.arg)
      return
    case 'ReturnExpr':
      if (e.value) visit(e.value)
      return
    case 'TryExpr':
      visit(e.body)
      for (const c of (e.catchClauses ?? (e.catchClause ? [e.catchClause] : [])) as { body: unknown }[]) {
        visit(c.body)
      }
      if (e.finallyClause) visit(e.finallyClause)
      return
    case 'TemplateLit':
      for (const ex of e.expressions as unknown[]) visit(ex)
      return
    case 'StyleBlock':
    case 'MarkdownBlock':
    case 'StringLit':
    case 'NumberLit':
    case 'Ident':
    case 'ClassRef':
    case 'RegexLit':
    case 'ExternalLambda':
      return
    default:
      return
  }
}
