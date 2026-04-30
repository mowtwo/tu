import { getScopedClassMap, lineColAt, parse, tokenize, TokenKind, type LetDecl, type Program, type StyleBlock, type Token } from '@tu/compiler'
import { getCSSLanguageService, type LanguageService as CssLanguageService } from 'vscode-css-languageservice'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { getOrCreateSession } from './lsp-session.js'
import { lineColToOffset, mapSourceLineColToTS } from './source-map.js'

export interface TuCompletionItem {
  /** Text shown in the completion list. */
  label: string
  /** TS-reported kind ('var' / 'function' / 'method' / 'parameter' / …). */
  kind: string
  /** Sort order — usually copied from TS's `sortText`; LSP merges these. */
  sortText: string
  /** Text actually inserted; defaults to `label`. */
  insertText?: string
  /** Quick-info-style detail string for the right-hand side of the popup. */
  detail?: string
  /** Markdown body. */
  documentation?: string
}

/**
 * The HTML tag names Tu's tag-call DSL renders into via `h(tag, ...)`.
 * Drives expression-head completion since tsserver — which only sees the
 * TS shadow — has no notion of "tags are completable here." Curated for
 * day-to-day UI work; users wanting more should `// @ts-ignore` or
 * extend.
 */
const HTML_TAGS: readonly string[] = [
  'a', 'abbr', 'address', 'area', 'article', 'aside', 'audio',
  'b', 'base', 'bdi', 'bdo', 'blockquote', 'body', 'br', 'button',
  'canvas', 'caption', 'cite', 'code', 'col', 'colgroup',
  'data', 'datalist', 'dd', 'del', 'details', 'dfn', 'dialog', 'div', 'dl', 'dt',
  'em', 'embed',
  'fieldset', 'figcaption', 'figure', 'footer', 'form',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'hr', 'html',
  'i', 'iframe', 'img', 'input', 'ins',
  'kbd',
  'label', 'legend', 'li', 'link',
  'main', 'map', 'mark', 'meta', 'meter',
  'nav', 'noscript',
  'object', 'ol', 'optgroup', 'option', 'output',
  'p', 'param', 'picture', 'pre', 'progress',
  'q',
  'rb', 'rp', 'rt', 'rtc', 'ruby',
  's', 'samp', 'script', 'section', 'select', 'slot', 'small', 'source', 'span',
  'strong', 'style', 'sub', 'summary', 'sup',
  'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th', 'thead', 'time',
  'title', 'tr', 'track',
  'u', 'ul',
  'var', 'video',
  'wbr',
]

/**
 * Resolve completions for a `(line, col)` cursor in a `.tu` source. Three
 * sources merged into one list:
 *
 *   1. tsserver `getCompletionsAtPosition` — user idents, params, imported
 *      names, etc. (the bulk of what users see).
 *   2. HTML tag names — when the cursor is at an expression head, since
 *      Tu compiles `div { … }` into an `h("div", …)` call that tsserver
 *      can't surface as a completion.
 *   3. Scoped-component class refs — when the cursor sits right after a
 *      `.` inside a component that owns a `style { … }` block.
 *
 * (1) handled by the cached LanguageService (M3.7); (2) and (3) are the
 * Tu-aware augmentation added in M3.10.
 */
export function completionsAtTuPosition(
  source: string,
  filename: string,
  line: number,
  col: number
): TuCompletionItem[] {
  // Inside a `style { … }` block, hand the cursor off to a real CSS
  // language service. tsserver has no business there (the CSS body is
  // a raw string in the TS shadow), and our HTML-tag heuristic would
  // pollute the suggestions.
  const cssItems = maybeCssCompletions(source, line, col)
  if (cssItems !== null) return cssItems

  const out: TuCompletionItem[] = []
  const tsItems = tsCompletions(source, filename, line, col)
  out.push(...tsItems)

  const ctx = analyzeCursorContext(source, line, col)
  if (ctx === null) return out

  if (ctx.kind === 'class-ref') {
    for (const cls of ctx.declared) {
      out.push({
        label: cls,
        kind: 'property',
        // Lead with `0` so declared classes outrank tsserver's lexically
        // similar suggestions in the merged list.
        sortText: '0_' + cls,
      })
    }
    return out
  }

  if (ctx.kind === 'expression-head') {
    const seen = new Set(out.map((c) => c.label))
    for (const tag of HTML_TAGS) {
      if (seen.has(tag)) continue
      out.push({
        label: tag,
        kind: 'function',
        // High sortText so HTML tags appear AFTER user-defined idents but
        // still in the list (most users want their own names first).
        sortText: '8_' + tag,
        detail: `Tu tag-call: emits h("${tag}", …)`,
      })
    }
  }

  return out
}

function tsCompletions(
  source: string,
  filename: string,
  line: number,
  col: number
): TuCompletionItem[] {
  const session = getOrCreateSession(source, filename)
  if (!session) return []
  const mapped = mapSourceLineColToTS(
    session.rootShadow.tokenMappings,
    session.rootShadow.tuSource,
    line,
    col,
    { inclusiveEnd: true }
  )
  if (!mapped) return []
  const info = session.service.getCompletionsAtPosition(
    session.rootShadow.virtualPath,
    mapped.tsOffset,
    {}
  )
  if (!info) return []
  return info.entries.map((e) => ({
    label: e.name,
    kind: e.kind,
    sortText: e.sortText,
    ...(e.insertText !== undefined ? { insertText: e.insertText } : {}),
  }))
}

interface ClassRefContext {
  kind: 'class-ref'
  /** Class names declared in the surrounding scoped component's style block. */
  declared: string[]
}

interface ExpressionHeadContext {
  kind: 'expression-head'
}

type CursorContext = ClassRefContext | ExpressionHeadContext

/**
 * Find the previous non-whitespace token before the cursor and use it to
 * classify what the user is plausibly typing. Token-based (not char-based)
 * so keywords like `let` don't masquerade as identifiers we should follow,
 * and so `Signal.State` doesn't trigger a ClassRef context.
 *
 * Cheap and never the SOLE source of completions — tsserver still runs
 * underneath; this only ADDS Tu-specific items (HTML tags, ClassRefs).
 */
function analyzeCursorContext(source: string, line: number, col: number): CursorContext | null {
  const offset = lineColToOffset(source, line, col)
  if (offset === null) return null
  let tokens: Token[]
  try {
    tokens = tokenize(source)
  } catch {
    return null
  }

  // `prev` = index of the last token whose `end <= offset`.
  let prev = -1
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]!.end <= offset && tokens[i]!.kind !== TokenKind.Eof) prev = i
    else break
  }

  // If the cursor sits right at the end of an in-progress Ident, the
  // "preceding context" is what came BEFORE that ident — step back one.
  let realPrev = prev
  if (
    prev >= 0 &&
    tokens[prev]!.kind === TokenKind.Ident &&
    tokens[prev]!.end === offset
  ) {
    realPrev = prev - 1
  }
  // Mid-ident (cursor inside an Ident span) — `prev` already points at
  // the token before the Ident, which is what we want.

  if (realPrev < 0) return null
  const prevTok = tokens[realPrev]!

  if (prevTok.kind === TokenKind.Dot) {
    // Tu's `.foo` is a ClassRef in expression position. Skip if the dot
    // looks like member access (preceded by an Ident with no whitespace
    // between) — Tu doesn't support that today, but if/when it does, we
    // don't want to confuse the user with class names there.
    const beforeDot = realPrev > 0 ? tokens[realPrev - 1]! : null
    if (
      beforeDot &&
      beforeDot.kind === TokenKind.Ident &&
      beforeDot.end === prevTok.start
    ) {
      return null
    }
    const classes = collectScopedClassesAt(source, offset)
    if (!classes) return null
    return { kind: 'class-ref', declared: [...classes].sort() }
  }

  if (
    prevTok.kind === TokenKind.LBrace ||
    prevTok.kind === TokenKind.LParen ||
    prevTok.kind === TokenKind.Comma ||
    prevTok.kind === TokenKind.Equals ||
    prevTok.kind === TokenKind.Colon ||
    prevTok.kind === TokenKind.FatArrow ||
    prevTok.kind === TokenKind.Else
  ) {
    return { kind: 'expression-head' }
  }
  return null
}

/**
 * Find the top-level component LetDecl whose source range contains
 * `offset`, and return the declared class names from its style block (if
 * any). Returns `null` when the offset isn't inside any scoped
 * component.
 *
 * If the source fails to parse (very common while the user is mid-typing
 * — `class: .` is incomplete Tu), we insert a placeholder ident at the
 * cursor and retry. The placeholder makes the surrounding form valid
 * without affecting the host lookup, since the inserted char is the
 * cursor position itself.
 */
function collectScopedClassesAt(source: string, offset: number): Set<string> | null {
  let program
  try {
    program = parse(tokenize(source), source)
  } catch {
    const patched = source.slice(0, offset) + 'X' + source.slice(offset)
    try {
      program = parse(tokenize(patched), patched)
    } catch {
      return null
    }
  }
  let host: LetDecl | null = null
  for (const stmt of program.body) {
    if (stmt.kind !== 'LetDecl') continue
    // The patched source may have shifted ranges by one byte; use a `<=`
    // upper bound so the cursor at-or-just-before the close still hits.
    if (offset >= stmt.start && offset <= stmt.end) {
      host = stmt
      break
    }
  }
  if (!host) return null
  const map = getScopedClassMap(program)
  return map.get(host.name) ?? null
}

// ─── CSS LSP delegation (M3.11) ────────────────────────────────────────────

// Lazy singleton — vscode-css-languageservice is heavy to construct.
let cssLs: CssLanguageService | null = null
function getCssLs(): CssLanguageService {
  if (!cssLs) cssLs = getCSSLanguageService()
  return cssLs
}

/**
 * If the cursor sits inside a `style { … }` block, slice the inner CSS
 * out and delegate completion to vscode-css-languageservice. Returns
 * `null` when the cursor is outside any style block (or the source can't
 * be parsed) — the caller falls back to the JS/Tu completion path.
 */
function maybeCssCompletions(
  source: string,
  line: number,
  col: number
): TuCompletionItem[] | null {
  const offset = lineColToOffset(source, line, col)
  if (offset === null) return null
  let program: Program
  try {
    program = parse(tokenize(source), source)
  } catch {
    return null
  }
  const block = findEnclosingStyleBlock(program, offset)
  if (!block) return null

  // Convert the source position to a position relative to the CSS body.
  const innerStartLC = lineColAt(source, block.cssStart) // 1-based
  const cursorLC = lineColAt(source, offset) // 1-based
  const cssLine = cursorLC.line - innerStartLC.line
  const cssCol = cssLine === 0 ? cursorLC.col - innerStartLC.col : cursorLC.col - 1
  if (cssLine < 0 || cssCol < 0) return []

  const cssDoc = TextDocument.create('inline://style.css', 'css', 1, block.css)
  const ls = getCssLs()
  const stylesheet = ls.parseStylesheet(cssDoc)
  const list = ls.doComplete(cssDoc, { line: cssLine, character: cssCol }, stylesheet)
  if (!list || list.items.length === 0) return []
  return list.items.map((it) => {
    const result: TuCompletionItem = {
      label: it.label,
      kind: cssKindToTsKind(it.kind),
      sortText: it.sortText ?? '5_' + it.label,
    }
    if (typeof it.insertText === 'string') result.insertText = it.insertText
    if (typeof it.detail === 'string') result.detail = it.detail
    if (typeof it.documentation === 'string') {
      result.documentation = it.documentation
    } else if (it.documentation && typeof it.documentation === 'object' && 'value' in it.documentation) {
      result.documentation = (it.documentation as { value: string }).value
    }
    return result
  })
}

function findEnclosingStyleBlock(program: Program, offset: number): StyleBlock | null {
  let found: StyleBlock | null = null
  for (const stmt of program.body) {
    if (stmt.kind !== 'LetDecl') continue
    walkForStyleBlock(stmt.value, offset, (b) => {
      found = b
    })
    if (found) break
  }
  return found
}

function walkForStyleBlock(
  expr: { kind: string } | undefined,
  offset: number,
  hit: (b: StyleBlock) => void
): void {
  if (!expr) return
  if (expr.kind === 'StyleBlock') {
    const b = expr as StyleBlock
    if (offset >= b.cssStart && offset <= b.cssEnd) hit(b)
    return
  }
  const e = expr as Record<string, unknown>
  switch (expr.kind) {
    case 'Lambda':
      walkForStyleBlock(e.body as { kind: string }, offset, hit)
      return
    case 'Block':
      for (const c of e.body as { kind: string }[]) walkForStyleBlock(c, offset, hit)
      return
    case 'TagCall':
      for (const p of e.props as { value: { kind: string } }[]) walkForStyleBlock(p.value, offset, hit)
      for (const c of e.children as { kind: string }[]) walkForStyleBlock(c, offset, hit)
      return
    case 'IfExpr':
      walkForStyleBlock(e.cond as { kind: string }, offset, hit)
      walkForStyleBlock(e.then as { kind: string }, offset, hit)
      if (e.else) walkForStyleBlock(e.else as { kind: string }, offset, hit)
      return
    case 'ForExpr':
      walkForStyleBlock(e.iter as { kind: string }, offset, hit)
      walkForStyleBlock(e.body as { kind: string }, offset, hit)
      return
    case 'ArrayLit':
      for (const c of e.elements as { kind: string }[]) walkForStyleBlock(c, offset, hit)
      return
    case 'CallExpr':
      for (const a of e.args as { kind: string }[]) walkForStyleBlock(a, offset, hit)
      return
    case 'BinaryExpr':
      walkForStyleBlock(e.left as { kind: string }, offset, hit)
      walkForStyleBlock(e.right as { kind: string }, offset, hit)
      return
    case 'AssignExpr':
      walkForStyleBlock(e.value as { kind: string }, offset, hit)
      return
    default:
      return
  }
}

function cssKindToTsKind(kind: number | undefined): string {
  // vscode-languageserver-types CompletionItemKind:
  //   13 = Enum, 14 = Keyword, 21 = Constant, 25 = TypeParameter
  // — most CSS completions come back as Property (10) or Value (12).
  if (kind === 14) return 'keyword'
  if (kind === 13) return 'enum'
  if (kind === 21) return 'const'
  if (kind === 25) return 'type'
  return 'property'
}
