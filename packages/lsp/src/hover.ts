import { lineColAt } from '@tu/compiler'
import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import ts from 'typescript'
import { mapSourceLineColToTS } from './source-map.js'
import {
  buildShadowGraph,
  getTuCompilerOptions,
  tuPathToTs,
  type Shadow,
} from './shadow-graph.js'

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
 * Resolve type info for a `(line, col)` cursor position in a `.tu` source.
 * Mirrors `checkTuSource`'s shadow-graph + ts.LanguageService approach,
 * but goes the other direction: source position → TS offset → quickInfo.
 *
 * Returns `null` when:
 *   - the source can't be compiled (broken Tu — diagnostics surface that)
 *   - the cursor lands outside any TokenMapping (whitespace, keywords, `=`)
 *   - tsserver has no quickInfo for the resolved TS position
 *
 * V1 builds a fresh LanguageService per call. Caching across hovers is
 * tracked as a deferred-perf row — correctness first.
 */
export function hoverAtTuPosition(
  source: string,
  filename: string,
  line: number,
  col: number
): TuHover | null {
  const rootAbsPath = isAbsolute(filename) ? filename : resolve(process.cwd(), filename)
  let shadows: Map<string, Shadow>
  try {
    shadows = buildShadowGraph(source, rootAbsPath)
  } catch {
    return null
  }
  const rootShadow = shadows.get(tuPathToTs(rootAbsPath))
  if (!rootShadow) return null

  const mapped = mapSourceLineColToTS(rootShadow.tokenMappings, rootShadow.tuSource, line, col)
  if (!mapped) return null

  const compilerOptions = getTuCompilerOptions()
  const service = ts.createLanguageService(
    createLsHost(shadows, rootShadow, compilerOptions),
    ts.createDocumentRegistry()
  )
  let quickInfo: ts.QuickInfo | undefined
  try {
    quickInfo = service.getQuickInfoAtPosition(rootShadow.virtualPath, mapped.tsOffset)
  } finally {
    service.dispose()
  }
  if (!quickInfo) return null

  const contents = ts.displayPartsToString(quickInfo.displayParts)
  const documentation = quickInfo.documentation && quickInfo.documentation.length > 0
    ? ts.displayPartsToString(quickInfo.documentation)
    : undefined
  // Use the originating source token's range (not quickInfo.textSpan, which
  // is in TS coordinates and could span a wider parent expression). The
  // tightest-token invariant guarantees this is exactly the token the user
  // pointed at.
  const startLC = lineColAt(rootShadow.tuSource, mapped.tokenSrcStart)
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
 * Build a LanguageServiceHost whose virtual filesystem is the shadow graph.
 * Files outside the graph fall through to `ts.sys` so the default lib + the
 * runtime `.d.ts` resolve normally.
 */
function createLsHost(
  shadows: Map<string, Shadow>,
  rootShadow: Shadow,
  compilerOptions: ts.CompilerOptions
): ts.LanguageServiceHost {
  return {
    getScriptFileNames: () => [rootShadow.virtualPath, ...shadows.keys()],
    getScriptVersion: () => '1', // single-shot per hover; no editing
    getScriptSnapshot: (name) => {
      const shadow = shadows.get(name)
      if (shadow) return ts.ScriptSnapshot.fromString(shadow.ts)
      const onDisk = ts.sys.readFile(name)
      if (onDisk === undefined) return undefined
      return ts.ScriptSnapshot.fromString(onDisk)
    },
    getCurrentDirectory: () => process.cwd(),
    getCompilationSettings: () => compilerOptions,
    // ts.getDefaultLibFilePath returns an absolute path; getDefaultLibFileName
    // returns a basename and would make the host miss the lib lookup.
    getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
    fileExists: (name) => shadows.has(name) || ts.sys.fileExists(name),
    readFile: (name) => shadows.get(name)?.ts ?? ts.sys.readFile(name),
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  }
}

/** Convenience: read .tu off disk and hover. */
export function hoverAtTuFile(path: string, line: number, col: number): TuHover | null {
  const source = readFileSync(path, 'utf-8')
  return hoverAtTuPosition(source, path, line, col)
}
