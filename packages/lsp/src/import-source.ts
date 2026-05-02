// M6.12 — import-source string hit detection.
//
// Tu's `import { X } from "./Card.tu"` and `export { X } from "./Card.tu"`
// statements include a quoted source string. The TS shadow erases the
// quote characters into a different shape (the codegen rewrites `.tu` →
// `.ts` and the quoted form lands inside a synthesized statement), so
// hover/goto-def at the source string falls through to `null` if we ask
// tsserver. This module detects when the cursor is inside such a string
// and resolves it to an absolute `.tu` path so hover.ts and definition.ts
// can surface useful info instead.

import { parse, tokenize } from '@tu-lang/compiler'
import { dirname, isAbsolute, resolve } from 'node:path'
import { lineColToOffset } from './source-map.js'

export interface ImportSourceHit {
  /** The verbatim source string from the `import … from "X"` clause (no quotes). */
  rawSource: string
  /** Absolute path the source resolves to, if it's a relative `.tu` path; otherwise `null`. */
  resolvedPath: string | null
  /** 0-based source-byte offset of the opening quote. */
  quoteStart: number
  /** 0-based source-byte offset of the closing quote (inclusive of the quote char). */
  quoteEnd: number
  /** AST kind that produced this string — useful for callers that surface different docs. */
  kind: 'ImportDecl' | 'ReExportDecl'
}

/**
 * If the cursor at `(line, col)` falls inside the source string of an
 * `import` or `export … from` statement, return its location + resolved
 * path. Returns `null` otherwise.
 *
 * The detection re-parses `source` — cheap relative to the LSP work and
 * keeps the helper self-contained. Files that don't parse return `null`
 * (no false positives).
 */
export function findImportSourceAt(
  source: string,
  filename: string,
  line: number,
  col: number
): ImportSourceHit | null {
  const cursor = lineColToOffset(source, line, col)
  if (cursor === null) return null
  let ast
  try {
    ast = parse(tokenize(source, filename), source, filename)
  } catch {
    return null
  }
  for (const stmt of ast.body) {
    if (stmt.kind !== 'ImportDecl' && stmt.kind !== 'ReExportDecl') continue
    // Locate the `from "..."` or `from '...'` quoted span by scanning the
    // statement's source slice. The AST stores the unquoted string in
    // `stmt.source`; we just need to find where it sits inside the
    // statement bytes so we can test cursor overlap.
    const quoted = findQuotedSubstring(source, stmt.start, stmt.end, stmt.source)
    if (!quoted) continue
    if (cursor < quoted.openIdx || cursor > quoted.closeIdx) continue
    const dir = dirname(isAbsolute(filename) ? filename : resolve(process.cwd(), filename))
    let resolvedPath: string | null = null
    if (stmt.source.startsWith('.') && stmt.source.endsWith('.tu')) {
      resolvedPath = resolve(dir, stmt.source)
    }
    return {
      rawSource: stmt.source,
      resolvedPath,
      quoteStart: quoted.openIdx,
      quoteEnd: quoted.closeIdx,
      kind: stmt.kind,
    }
  }
  return null
}

/**
 * Find the byte range `[openIdx..closeIdx]` of a quoted occurrence of
 * `target` inside `source[start..end)`. Handles both `"…"` and `'…'`
 * forms; returns `null` if no exact-text match is found in that window.
 */
function findQuotedSubstring(
  source: string,
  start: number,
  end: number,
  target: string
): { openIdx: number; closeIdx: number } | null {
  for (const quote of ['"', "'"]) {
    const needle = quote + target + quote
    const idx = source.indexOf(needle, start)
    if (idx === -1) continue
    if (idx + needle.length > end) continue
    return { openIdx: idx, closeIdx: idx + needle.length - 1 }
  }
  return null
}
