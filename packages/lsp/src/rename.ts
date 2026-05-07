import { pathToFileURL } from 'node:url'
import { getOrCreateSession } from './lsp-session.js'
import { mapSourceLineColToTS, mapTSRangeToSource } from './source-map.js'

export interface TuRenameEdit {
  /** `file://` URI of the `.tu` file containing this edit. */
  uri: string
  /** 0-based line in that file. */
  line: number
  /** 0-based column in that file. */
  col: number
  /** Source-byte length of the original token to replace. */
  length: number
  /** Replacement text — uniform across all edits in one rename. */
  newText: string
}

/**
 * Compute the workspace edits for renaming a Tu identifier at `(line, col)`
 * to `newName`. Walks the import graph (via the cached LanguageService) so
 * cross-`.tu` references are renamed in lock-step with the declaration site.
 *
 * Returns `[]` when:
 *   - `newName` is not a valid Tu identifier
 *   - the source can't be compiled
 *   - the cursor is on a literal / keyword / whitespace
 *   - tsserver refuses the rename (e.g. cursor on a built-in symbol)
 *   - none of the rename locations land in `.tu` files we know about
 *
 * The LSP layer turns this into a `WorkspaceEdit`.
 */
export function renameAtTuPosition(
  source: string,
  filename: string,
  line: number,
  col: number,
  newName: string,
  inMemorySources?: ReadonlyMap<string, string>
): TuRenameEdit[] {
  if (!isValidTuIdent(newName)) return []
  const session = getOrCreateSession(source, filename, inMemorySources)
  if (!session) return []
  const mapped = mapSourceLineColToTS(
    session.rootShadow.tokenMappings,
    session.rootShadow.tuSource,
    line,
    col
  )
  if (!mapped) return []
  const locs = session.service.findRenameLocations(
    session.rootShadow.virtualPath,
    mapped.tsOffset,
    /* findInStrings */ false,
    /* findInComments */ false,
    /* providePrefixAndSuffixTextForRename */ false
  )
  if (!locs || locs.length === 0) return []

  const out: TuRenameEdit[] = []
  const seenSource = new Set<string>()
  for (const loc of locs) {
    const targetShadow = session.shadows.get(loc.fileName)
    if (!targetShadow) continue
    const range = mapTSRangeToSource(
      targetShadow.tokenMappings,
      targetShadow.ts,
      targetShadow.tuSource,
      loc.textSpan.start,
      loc.textSpan.length,
      targetShadow.mapPos
    )
    const sourceKey = `${targetShadow.tuPath}:${range.line}:${range.col}:${range.length}`
    if (seenSource.has(sourceKey)) continue
    seenSource.add(sourceKey)
    out.push({
      uri: pathToFileURL(targetShadow.tuPath).toString(),
      line: range.line,
      col: range.col,
      length: range.length,
      newText: newName,
    })
  }
  return preferWidestDuplicateSpans(out)
}

function preferWidestDuplicateSpans(items: TuRenameEdit[]): TuRenameEdit[] {
  const best = new Map<string, TuRenameEdit>()
  for (const item of items) {
    const key = `${item.uri}:${item.line}:${item.col}`
    const prev = best.get(key)
    if (!prev || item.length > prev.length) best.set(key, item)
  }
  return items.filter((item) => best.get(`${item.uri}:${item.line}:${item.col}`) === item)
}

/**
 * Tu identifiers follow JS identifier rules with a smaller alphabet — letters,
 * digits, `_`, `$`. Empty / non-Tu inputs are rejected so the LSP rename
 * roundtrip never produces a broken `.tu` source.
 */
function isValidTuIdent(name: string): boolean {
  if (name.length === 0) return false
  if (!/^[A-Za-z_$]/.test(name)) return false
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
}
