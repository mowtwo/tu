import { lineColAt } from '@tu-lang/compiler'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { findImportSourceAt } from './import-source.js'
import { getOrCreateSession } from './lsp-session.js'
import { mapSourceLineColToTS, mapTSRangeToSource } from './source-map.js'

export interface TuDefinition {
  /** `file://` URI of the `.tu` file containing the definition. */
  uri: string
  /** 0-based line in that file. */
  line: number
  /** 0-based column in that file. */
  col: number
  /** Source-byte length of the named symbol — drives the LSP target range. */
  length: number
}

/**
 * Resolve goto-definition for a `(line, col)` cursor in a `.tu` source.
 * Reuses the cached LanguageService when possible (see lsp-session.ts).
 *
 * The definition may live in another `.tu` file (cross-`.tu` imports). The
 * shadow graph already includes those, and each shadow carries its own
 * `tokenMappings`, so the TS textSpan returned by tsserver translates back
 * to the right source byte range in the right file.
 */
export function definitionAtTuPosition(
  source: string,
  filename: string,
  line: number,
  col: number,
  inMemorySources?: ReadonlyMap<string, string>
): TuDefinition[] {
  // Import-source string — `import { … } from "./Card.tu"`. Goto-def
  // jumps to the head of the resolved file. (M6.12.) Handled before the
  // tsserver path because the source string isn't covered by a TS
  // textSpan we could map back.
  const importHit = findImportSourceAt(source, filename, line, col)
  if (importHit !== null && importHit.resolvedPath !== null) {
    const exists =
      inMemorySources?.has(importHit.resolvedPath) ?? existsSync(importHit.resolvedPath)
    if (exists) {
      return [
        {
          uri: pathToFileURL(importHit.resolvedPath).toString(),
          line: 0,
          col: 0,
          length: 0,
        },
      ]
    }
  }

  const session = getOrCreateSession(source, filename, inMemorySources)
  if (!session) return []
  const mapped = mapSourceLineColToTS(
    session.rootShadow.tokenMappings,
    session.rootShadow.tuSource,
    line,
    col
  )
  // M9 LSP — type-name goto-def. The cursor MIGHT be inside a type-
  // annotation raw-text span the source map doesn't cover (e.g. on
  // `User` in `let alice: User = …`); in that case `mapped` is null
  // and the tsserver path can't run. Probe the cursor word against
  // the shadow graph's interface decls before returning empty. Also
  // serves as a fallback when tsserver returns 0 defs for a name
  // that IS one of our interfaces.
  const wordAtCursor = identifierAt(source, line, col)
  const interfaceFallback: TuDefinition[] = []
  if (wordAtCursor !== null) {
    for (const shadow of session.shadows.values()) {
      for (const stmt of shadow.ast.body) {
        if (stmt.kind !== 'InterfaceDecl') continue
        if (stmt.name !== wordAtCursor) continue
        const lc = lineColAt(shadow.tuSource, stmt.nameStart)
        interfaceFallback.push({
          uri: pathToFileURL(shadow.tuPath).toString(),
          line: lc.line - 1,
          col: lc.col - 1,
          length: stmt.nameEnd - stmt.nameStart,
        })
      }
    }
  }
  if (!mapped) return interfaceFallback
  const defs = session.service.getDefinitionAtPosition(
    session.rootShadow.virtualPath,
    mapped.tsOffset
  )
  if (!defs || defs.length === 0) return interfaceFallback

  const out: TuDefinition[] = []
  for (const d of defs) {
    const targetShadow = session.shadows.get(d.fileName)
    if (!targetShadow) continue // .d.ts / runtime — skip
    const range = mapTSRangeToSource(
      targetShadow.tokenMappings,
      targetShadow.ts,
      targetShadow.tuSource,
      d.textSpan.start,
      d.textSpan.length,
      targetShadow.mapPos
    )
    out.push({
      uri: pathToFileURL(targetShadow.tuPath).toString(),
      line: range.line,
      col: range.col,
      length: range.length,
    })
  }
  // If tsserver had nothing AND we have an interface match, return it.
  if (out.length === 0) return interfaceFallback
  return out
}

/**
 * Extract the JS-style identifier at `(line, col)` from `source`. Returns
 * the word if the cursor is inside / at the boundary of one, else null.
 * Only used for the M9 type-name goto-def fallback.
 */
function identifierAt(source: string, line: number, col: number): string | null {
  const lines = source.split('\n')
  const text = lines[line]
  if (text === undefined) return null
  if (col < 0 || col > text.length) return null
  // Scan left + right from the cursor to identify the identifier span.
  const isPart = (ch: string) => /^[A-Za-z_$\w]$/.test(ch)
  let s = col
  let e = col
  while (s > 0 && isPart(text[s - 1] ?? '')) s--
  while (e < text.length && isPart(text[e] ?? '')) e++
  if (s === e) return null
  const word = text.slice(s, e)
  // Reject pure-numeric runs (`123` shouldn't match).
  if (/^\d/.test(word)) return null
  return word
}
