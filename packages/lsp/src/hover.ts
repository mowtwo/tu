import { lineColAt } from '@tu/compiler'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { getOrCreateSession } from './lsp-session.js'
import { mapSourceLineColToTS } from './source-map.js'

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
  const session = getOrCreateSession(source, filename)
  if (!session) return null
  const mapped = mapSourceLineColToTS(
    session.rootShadow.tokenMappings,
    session.rootShadow.tuSource,
    line,
    col
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

/** Convenience: read .tu off disk and hover. */
export function hoverAtTuFile(path: string, line: number, col: number): TuHover | null {
  const source = readFileSync(path, 'utf-8')
  return hoverAtTuPosition(source, path, line, col)
}
