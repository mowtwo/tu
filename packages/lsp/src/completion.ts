import { getScopedClassMap, parse, tokenize, TokenKind, type LetDecl, type Token } from '@tu/compiler'
import { cssService, findCssContextAt } from './css-lsp.js'
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
/**
 * Type names surfaced inside a type-annotation position (`let X: |` or
 * `(p: |)`). Built-in TS scalars + Tu's runtime exports. User-defined
 * `type X = …` aliases are added on top per file.
 */
const TYPE_COMPLETIONS: readonly string[] = [
  // TS built-in scalars
  'string', 'number', 'boolean', 'void', 'null', 'undefined',
  'any', 'unknown', 'never', 'object', 'bigint', 'symbol',
  // Tu runtime types (auto-imported in TS-mode emit)
  'VNode', 'Child',
  // Reactive cell wrappers
  'Signal.State', 'Signal.Computed',
]

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

  if (ctx.kind === 'type-position') {
    const seen = new Set(out.map((c) => c.label))
    for (const t of TYPE_COMPLETIONS) {
      if (seen.has(t)) continue
      out.push({ label: t, kind: 'type', sortText: '1_' + t })
    }
    for (const t of ctx.userTypes) {
      if (seen.has(t)) continue
      out.push({ label: t, kind: 'type', sortText: '0_' + t, detail: 'Tu type alias' })
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

interface TypeContext {
  kind: 'type-position'
  /** User-defined type-alias names parsed from the same source. */
  userTypes: string[]
}

type CursorContext = ClassRefContext | ExpressionHeadContext | TypeContext

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

  // Inside a `class: …` tag-call prop value? Surface declared classes.
  if (prevTok.kind === TokenKind.Colon && realPrev > 0) {
    const before = tokens[realPrev - 1]!
    if (before.kind === TokenKind.Ident && before.text === 'class') {
      const classes = collectScopedClassesAt(source, offset)
      if (classes) {
        return {
          kind: 'class-ref',
          declared: [...classes].map((c) => `.${c}`).sort(),
        }
      }
    }
  }

  // Type position? After `:` in a `let X: …` or `(p: …)` annotation.
  if (prevTok.kind === TokenKind.Colon && isTypePositionAfter(tokens, realPrev)) {
    return { kind: 'type-position', userTypes: collectUserTypes(source) }
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

/**
 * Decide whether a `:` at `colonIdx` is opening a type annotation (vs a
 * tag-call prop value). Walks backward from the colon, looking for the
 * surrounding context: a `Let` keyword (let-decl annotation) or an
 * unmatched `LParen` at start-of-line / start-of-source level (lambda
 * param annotation). Stops at any decisive boundary token to avoid
 * walking too far.
 */
function isTypePositionAfter(tokens: Token[], colonIdx: number): boolean {
  let parenDepth = 0
  for (let i = colonIdx - 1; i >= 0; i--) {
    const t = tokens[i]!
    if (
      t.kind === TokenKind.Equals ||
      t.kind === TokenKind.Semi ||
      t.kind === TokenKind.RBrace ||
      t.kind === TokenKind.LBrace ||
      t.kind === TokenKind.FatArrow
    ) {
      return false
    }
    if (t.kind === TokenKind.RParen) parenDepth++
    if (t.kind === TokenKind.LParen) {
      if (parenDepth === 0) {
        // Walked back to the opening paren — we're inside a paren group.
        // If the LParen is preceded by an Ident, this might be a CallExpr
        // or TagCall args, NOT a lambda param list (those don't have a
        // callee Ident). Param lists open with bare LParen (lambdas) or
        // `=>` after them. Look one token back: if it's an Ident, NOT a
        // param list.
        const before = i > 0 ? tokens[i - 1] : null
        if (before && before.kind === TokenKind.Ident) return false
        return true
      }
      parenDepth--
    }
    if (t.kind === TokenKind.Let && parenDepth === 0) return true
  }
  return false
}

/**
 * Find every top-level `type X = …` declaration in `source` and return
 * the names. Uses a regex scan so it works even when the rest of the
 * file is mid-typing and won't parse cleanly (`let alice: |` → parse
 * error, but a `type Person = …` above is still extractable).
 */
function collectUserTypes(source: string): string[] {
  const re = /^[ \t]*(?:export[ \t]+)?type[ \t]+([A-Za-z_$][A-Za-z0-9_$]*)[ \t]*=/gm
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) out.push(m[1]!)
  return out
}

// ─── CSS LSP delegation (M3.11) ────────────────────────────────────────────

/**
 * If the cursor sits inside a `style { … }` block, delegate completion
 * to vscode-css-languageservice. Returns `null` when the cursor is
 * outside any style block — the caller falls back to the JS/Tu path.
 */
function maybeCssCompletions(
  source: string,
  line: number,
  col: number
): TuCompletionItem[] | null {
  const ctx = findCssContextAt(source, line, col)
  if (!ctx) return null
  const list = cssService().doComplete(
    ctx.doc,
    { line: ctx.cssLine, character: ctx.cssCol },
    ctx.stylesheet
  )
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
