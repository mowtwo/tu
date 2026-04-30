import { getOrCreateSession } from './lsp-session.js'
import { mapSourceLineColToTS } from './source-map.js'

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
 * Resolve completions for a `(line, col)` cursor in a `.tu` source. Reuses
 * the cached LanguageService when possible (see lsp-session.ts).
 *
 * Returns `[]` when no completions are available. `inclusiveEnd` mapping
 * lets cursors at exactly `srcEnd` of an identifier (the typical
 * mid-typing position) still resolve to that token.
 */
export function completionsAtTuPosition(
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
