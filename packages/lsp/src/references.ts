import { pathToFileURL } from 'node:url'
import { getOrCreateSession } from './lsp-session.js'
import { mapSourceLineColToTS, mapTSRangeToSource } from './source-map.js'

export interface TuReferenceLocation {
  /** `file://` URI of the `.tu` file containing this reference. */
  uri: string
  /** 0-based line in that file. */
  line: number
  /** 0-based column in that file. */
  col: number
  /** Source-byte length of the reference token. */
  length: number
  /** True when this entry is the symbol's definition site (vs. a read/use). */
  isDefinition: boolean
}

/**
 * Collect every cross-`.tu` reference of the symbol under `(line, col)`.
 *
 * Mirrors `renameAtTuPosition`'s shadow-graph traversal: maps the cursor to
 * its TS offset, calls `getReferencesAtPosition`, then reverse-maps each TS
 * span back through the *target* shadow's `tokenMappings` so cross-file
 * references resolve correctly.
 *
 * Returns `[]` when:
 *   - the source can't be compiled
 *   - the cursor is on a literal / keyword / whitespace
 *   - tsserver finds no references (unused private binding, etc.)
 *   - every TS reference falls outside the shadow graph (e.g. into platform
 *     `.d.ts` files we deliberately don't surface as user-facing locations)
 *
 * The LSP layer turns this into `Location[]` for the `textDocument/references`
 * response.
 */
export function referencesAtTuPosition(
  source: string,
  filename: string,
  line: number,
  col: number,
  options: { includeDeclaration?: boolean } = {},
  inMemorySources?: ReadonlyMap<string, string>
): TuReferenceLocation[] {
  const session = getOrCreateSession(source, filename, inMemorySources)
  if (!session) return []
  const mapped = mapSourceLineColToTS(
    session.rootShadow.tokenMappings,
    session.rootShadow.tuSource,
    line,
    col
  )
  if (!mapped) return []
  // `findReferences` returns ReferencedSymbol[]: each symbol carries its
  // definition (textSpan + fileName) AND a list of reference entries. This
  // is the right API for LSP's `textDocument/references` because we need to
  // emit (definition, uses) with reliable provenance — `getReferencesAtPosition`
  // returns ReferenceEntry[] where `isDefinition` is undefined for many
  // entries, so we'd misclassify the declaration site.
  const found = session.service.findReferences(
    session.rootShadow.virtualPath,
    mapped.tsOffset
  )
  if (!found || found.length === 0) return []

  const includeDeclaration = options.includeDeclaration ?? true
  const out: TuReferenceLocation[] = []
  // Tracks (filename, start, length) we've already emitted so a definition
  // site that ALSO appears as a reference (TS sometimes does this) doesn't
  // double-list.
  const seen = new Set<string>()
  // Generated helper/interface code can legitimately point multiple TS spans
  // back to the same Tu token. Keep the user-facing location list unique.
  const seenSource = new Set<string>()
  const push = (
    fileName: string,
    spanStart: number,
    spanLength: number,
    isDef: boolean
  ): void => {
    const targetShadow = session.shadows.get(fileName)
    if (!targetShadow) return
    const key = `${fileName}:${spanStart}:${spanLength}`
    if (seen.has(key)) return
    seen.add(key)
    const range = mapTSRangeToSource(
      targetShadow.tokenMappings,
      targetShadow.ts,
      targetShadow.tuSource,
      spanStart,
      spanLength,
      targetShadow.mapPos
    )
    const sourceKey = `${targetShadow.tuPath}:${range.line}:${range.col}:${range.length}`
    if (seenSource.has(sourceKey)) return
    seenSource.add(sourceKey)
    out.push({
      uri: pathToFileURL(targetShadow.tuPath).toString(),
      line: range.line,
      col: range.col,
      length: range.length,
      isDefinition: isDef,
    })
  }
  for (const sym of found) {
    if (includeDeclaration) {
      push(
        sym.definition.fileName,
        sym.definition.textSpan.start,
        sym.definition.textSpan.length,
        /* isDef */ true
      )
    }
    for (const ref of sym.references) {
      // Skip the declaration entry when its span matches the symbol's
      // definition span — TS includes the decl as a reference in some
      // cases. With includeDeclaration: false we drop it entirely; with
      // true the dedupe `seen` guard prevents the duplicate.
      const isDef =
        ref.fileName === sym.definition.fileName &&
        ref.textSpan.start === sym.definition.textSpan.start &&
        ref.textSpan.length === sym.definition.textSpan.length
      if (!includeDeclaration && isDef) continue
      push(ref.fileName, ref.textSpan.start, ref.textSpan.length, isDef)
    }
  }
  return out
}
