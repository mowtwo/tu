import { lineColAt } from '@tu-lang/compiler'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { cssService, findCssContextAt } from './css-lsp.js'
import { findAttrAt, findTagCallAt, renderHtmlAttrDocs, renderHtmlTagDocs } from './html-lsp.js'
import { getOrCreateSession } from './lsp-session.js'
import { lineColToOffset, mapSourceLineColToTS } from './source-map.js'

export interface TuHover {
  /** TS-style display string (`(parameter) name: string`, `Signal.State<number>`, …). */
  contents: string
  /** JSDoc body if the symbol carries one; absent otherwise. */
  documentation?: string
  /** 0-based line in the .tu source where the hovered token starts. */
  line: number
  /** 0-based column in the .tu source where the hovered token starts. */
  col: number
  /** Hovered token's source-byte length — drives the LSP range end. */
  length: number
}

/**
 * Resolve type info for a `(line, col)` cursor in a `.tu` source. Reuses a
 * cached LanguageService when possible (see lsp-session.ts).
 */
export function hoverAtTuPosition(
  source: string,
  filename: string,
  line: number,
  col: number
): TuHover | null {
  // CSS body? Delegate to the CSS language service before touching ts.
  const cssHover = maybeCssHover(source, line, col)
  if (cssHover !== undefined) return cssHover

  // HTML tag identifier in markup position (e.g. cursor on `div` inside
  // `div { … }` or `button(onClick: …) { … }`). Tu's tag-calls compile to
  // `h("div", …)` strings that tsserver can't surface docs for, so we
  // delegate to vscode-html-languageservice's tag-data tables instead.
  const htmlHover = maybeHtmlTagHover(source, line, col)
  if (htmlHover !== null) return htmlHover

  // HTML attribute name (`class`, `onClick`, `href`, …) inside a
  // tag-call's prop list. Same data source as tag hover; surfaces the
  // MDN attribute description.
  const attrHover = maybeHtmlAttrHover(source, line, col)
  if (attrHover !== null) return attrHover

  const session = getOrCreateSession(source, filename)
  if (!session) return null
  // Inclusive end so a cursor sitting at the token's trailing edge
  // still resolves — VS Code typically pins the cursor to the end of
  // the last char being pointed at.
  const mapped = mapSourceLineColToTS(
    session.rootShadow.tokenMappings,
    session.rootShadow.tuSource,
    line,
    col,
    { inclusiveEnd: true }
  )
  if (!mapped) return null
  const quickInfo = session.service.getQuickInfoAtPosition(
    session.rootShadow.virtualPath,
    mapped.tsOffset
  )
  if (!quickInfo) return null

  const contents = ts.displayPartsToString(quickInfo.displayParts)
  const documentation = quickInfo.documentation && quickInfo.documentation.length > 0
    ? ts.displayPartsToString(quickInfo.documentation)
    : undefined
  // Use the originating source token's range — see M3.3 design notes for why
  // we don't round-trip `quickInfo.textSpan` here.
  const startLC = lineColAt(session.rootShadow.tuSource, mapped.tokenSrcStart)
  const length = Math.max(1, mapped.tokenSrcEnd - mapped.tokenSrcStart)
  const result: TuHover = {
    contents,
    line: startLC.line - 1,
    col: startLC.col - 1,
    length,
  }
  if (documentation !== undefined) result.documentation = documentation
  return result
}

/**
 * Hover for an HTML tag identifier in markup position. Returns null if
 * the cursor isn't on a known HTML tag — caller falls through to tsserver.
 */
function maybeHtmlTagHover(
  source: string,
  line: number,
  col: number
): TuHover | null {
  const offset = lineColToOffset(source, line, col)
  if (offset === null) return null
  const hit = findTagCallAt(source, offset)
  if (!hit) return null
  const docs = renderHtmlTagDocs(hit.tag)
  if (!docs) return null
  // line/col returned by lineColAt are 1-based; LSP wants 0-based.
  const startLC = lineColAt(source, hit.start)
  return {
    contents: docs,
    line: startLC.line - 1,
    col: startLC.col - 1,
    length: hit.end - hit.start,
  }
}

/**
 * Hover for an HTML attribute name (`class`, `onClick`, `href`, …) at
 * a tag-call's prop. Returns null if the cursor isn't on an attribute
 * name, or the tag/attr pair isn't in vscode-html-languageservice's
 * data tables.
 */
function maybeHtmlAttrHover(
  source: string,
  line: number,
  col: number
): TuHover | null {
  const offset = lineColToOffset(source, line, col)
  if (offset === null) return null
  const hit = findAttrAt(source, offset)
  if (!hit) return null
  const docs = renderHtmlAttrDocs(hit.tag, hit.attr)
  if (!docs) return null
  const startLC = lineColAt(source, hit.start)
  return {
    contents: docs,
    line: startLC.line - 1,
    col: startLC.col - 1,
    length: hit.end - hit.start,
  }
}

/** Convenience: read .tu off disk and hover. */
export function hoverAtTuFile(path: string, line: number, col: number): TuHover | null {
  const source = readFileSync(path, 'utf-8')
  return hoverAtTuPosition(source, path, line, col)
}

/**
 * If the cursor is inside a `style { … }` block, ask the CSS language
 * service for hover info. Returns:
 *   - a TuHover when the CSS LS produced a hit
 *   - `null` when the CSS LS had nothing AT this CSS position (we still
 *     don't want to fall through to tsserver — CSS context is exclusive)
 *   - `undefined` when the cursor isn't in a style block (caller falls
 *     through to the tsserver path)
 */
function maybeCssHover(
  source: string,
  line: number,
  col: number
): TuHover | null | undefined {
  const ctx = findCssContextAt(source, line, col)
  if (!ctx) return undefined
  const result = cssService().doHover(
    ctx.doc,
    { line: ctx.cssLine, character: ctx.cssCol },
    ctx.stylesheet
  )
  if (!result) return null
  const contents = stringifyHoverContents(result.contents)
  if (!contents) return null
  // Range comes back in CSS-doc coordinates (0-based line/char, relative
  // to the style body). Translate to source-doc coordinates by adding the
  // style body's start line / col offset.
  const range = result.range ?? { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }
  const innerStart = lineColAt(source, ctx.block.cssStart) // 1-based
  const startLine = innerStart.line - 1 + range.start.line
  const startCol =
    range.start.line === 0 ? innerStart.col - 1 + range.start.character : range.start.character
  const endCol =
    range.end.line === 0 ? innerStart.col - 1 + range.end.character : range.end.character
  // Length on the same line (most CSS hover ranges are single-line).
  const length = range.start.line === range.end.line ? Math.max(1, endCol - startCol) : 1
  return {
    contents,
    line: startLine,
    col: startCol,
    length,
  }
}

function stringifyHoverContents(contents: unknown): string {
  if (typeof contents === 'string') return contents
  if (Array.isArray(contents)) {
    return contents.map(stringifyHoverContents).filter(Boolean).join('\n\n')
  }
  if (contents && typeof contents === 'object') {
    const c = contents as { value?: string; kind?: string; language?: string }
    if (typeof c.value === 'string') return c.value
  }
  return ''
}
