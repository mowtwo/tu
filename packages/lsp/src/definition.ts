import { pathToFileURL } from 'node:url'
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
  col: number
): TuDefinition[] {
  const session = getOrCreateSession(source, filename)
  if (!session) return []
  const mapped = mapSourceLineColToTS(
    session.rootShadow.tokenMappings,
    session.rootShadow.tuSource,
    line,
    col
  )
  if (!mapped) return []
  const defs = session.service.getDefinitionAtPosition(
    session.rootShadow.virtualPath,
    mapped.tsOffset
  )
  if (!defs || defs.length === 0) return []

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
  return out
}
