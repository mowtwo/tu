import { lineColAt, parse, tokenize, type Program, type StyleBlock } from '@tu/compiler'
import { getCSSLanguageService, type LanguageService as CssLanguageService } from 'vscode-css-languageservice'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { lineColToOffset } from './source-map.js'

// Lazy singleton — vscode-css-languageservice is heavy to construct.
let cssLs: CssLanguageService | null = null
function getCssLs(): CssLanguageService {
  if (!cssLs) cssLs = getCSSLanguageService()
  return cssLs
}

/**
 * Locate the cursor inside a `style { … }` block, if any. Returns the
 * surrounding StyleBlock plus the cursor's position TRANSLATED into the
 * CSS body's coordinates (0-based, the form vscode-css-languageservice
 * expects). Returns `null` when the cursor isn't inside a CSS span.
 */
export interface CssContext {
  block: StyleBlock
  /** Synthetic CSS document holding the inner CSS text. */
  doc: TextDocument
  /** Pre-parsed stylesheet — building it once and threading through. */
  stylesheet: ReturnType<CssLanguageService['parseStylesheet']>
  /** 0-based line in the CSS body where the cursor sits. */
  cssLine: number
  /** 0-based column in the CSS body where the cursor sits. */
  cssCol: number
}

export function findCssContextAt(
  source: string,
  line: number,
  col: number
): CssContext | null {
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

  const innerStartLC = lineColAt(source, block.cssStart) // 1-based
  const cursorLC = lineColAt(source, offset) // 1-based
  const cssLine = cursorLC.line - innerStartLC.line
  const cssCol = cssLine === 0 ? cursorLC.col - innerStartLC.col : cursorLC.col - 1
  if (cssLine < 0 || cssCol < 0) return null

  const doc = TextDocument.create('inline://style.css', 'css', 1, block.css)
  const ls = getCssLs()
  const stylesheet = ls.parseStylesheet(doc)
  return { block, doc, stylesheet, cssLine, cssCol }
}

export function cssService(): CssLanguageService {
  return getCssLs()
}

/**
 * Run CSS validation over every `style { … }` block in `program`. Each
 * CSS-LS diagnostic comes back in CSS-doc-relative coordinates; this
 * function translates them to source-doc absolute (line, col, length)
 * so the LSP diagnostic publisher can surface them on the right `.tu`
 * line.
 */
export interface CssBlockDiagnostic {
  line: number
  col: number
  length: number
  severity: 'error' | 'warning' | 'info' | 'hint'
  message: string
}

export function validateCssBlocks(source: string, program: Program): CssBlockDiagnostic[] {
  const out: CssBlockDiagnostic[] = []
  const ls = getCssLs()
  for (const stmt of program.body) {
    if (stmt.kind !== 'LetDecl') continue
    visitStyleBlocks(stmt.value, (block) => {
      const doc = TextDocument.create('inline://style.css', 'css', 1, block.css)
      const stylesheet = ls.parseStylesheet(doc)
      const diags = ls.doValidation(doc, stylesheet)
      const innerStartLC = lineColAt(source, block.cssStart) // 1-based
      for (const d of diags) {
        const startLine = innerStartLC.line - 1 + d.range.start.line
        const startCol =
          d.range.start.line === 0
            ? innerStartLC.col - 1 + d.range.start.character
            : d.range.start.character
        const endCol =
          d.range.end.line === 0
            ? innerStartLC.col - 1 + d.range.end.character
            : d.range.end.character
        const length =
          d.range.start.line === d.range.end.line
            ? Math.max(1, endCol - startCol)
            : 1
        out.push({
          line: startLine,
          col: startCol,
          length,
          severity: cssSeverity(d.severity),
          message: d.message,
        })
      }
    })
  }
  return out
}

function cssSeverity(s: number | undefined): 'error' | 'warning' | 'info' | 'hint' {
  // vscode-languageserver-types DiagnosticSeverity:
  //   1 = Error, 2 = Warning, 3 = Information, 4 = Hint
  if (s === 1) return 'error'
  if (s === 2) return 'warning'
  if (s === 4) return 'hint'
  return 'info'
}

function findEnclosingStyleBlock(program: Program, offset: number): StyleBlock | null {
  let found: StyleBlock | null = null
  for (const stmt of program.body) {
    if (stmt.kind !== 'LetDecl') continue
    visitStyleBlocks(stmt.value, (b) => {
      if (offset >= b.cssStart && offset <= b.cssEnd) found = b
    })
    if (found) break
  }
  return found
}

/** Visit every `StyleBlock` reachable from `expr` (depth-first). */
function visitStyleBlocks(
  expr: { kind: string } | undefined,
  hit: (b: StyleBlock) => void
): void {
  if (!expr) return
  if (expr.kind === 'StyleBlock') {
    hit(expr as StyleBlock)
    return
  }
  const e = expr as Record<string, unknown>
  switch (expr.kind) {
    case 'Lambda':
      visitStyleBlocks(e.body as { kind: string }, hit)
      return
    case 'Block':
      for (const c of e.body as { kind: string }[]) visitStyleBlocks(c, hit)
      return
    case 'TagCall':
      for (const p of e.props as { value: { kind: string } }[]) visitStyleBlocks(p.value, hit)
      for (const c of e.children as { kind: string }[]) visitStyleBlocks(c, hit)
      return
    case 'IfExpr':
      visitStyleBlocks(e.cond as { kind: string }, hit)
      visitStyleBlocks(e.then as { kind: string }, hit)
      if (e.else) visitStyleBlocks(e.else as { kind: string }, hit)
      return
    case 'ForExpr':
      visitStyleBlocks(e.iter as { kind: string }, hit)
      visitStyleBlocks(e.body as { kind: string }, hit)
      return
    case 'ArrayLit':
      for (const c of e.elements as { kind: string }[]) visitStyleBlocks(c, hit)
      return
    case 'ObjectLit':
      for (const p of e.properties as { value: { kind: string } }[]) visitStyleBlocks(p.value, hit)
      return
    case 'MemberExpr':
      visitStyleBlocks(e.object as { kind: string }, hit)
      return
    case 'CallExpr':
      for (const a of e.args as { kind: string }[]) visitStyleBlocks(a, hit)
      if (Array.isArray(e.children)) {
        for (const c of e.children as { kind: string }[]) visitStyleBlocks(c, hit)
      }
      return
    case 'BinaryExpr':
      visitStyleBlocks(e.left as { kind: string }, hit)
      visitStyleBlocks(e.right as { kind: string }, hit)
      return
    case 'AssignExpr':
      visitStyleBlocks(e.value as { kind: string }, hit)
      return
    default:
      return
  }
}
