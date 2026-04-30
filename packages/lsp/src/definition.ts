import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { mapSourceLineColToTS, mapTSRangeToSource } from './source-map.js'
import {
  buildShadowGraph,
  getTuCompilerOptions,
  tuPathToTs,
  type Shadow,
} from './shadow-graph.js'

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
 * Resolve goto-definition for a `(line, col)` cursor in a `.tu` source. The
 * definition may live in another `.tu` file (cross-`.tu` imports) — the
 * shadow graph already includes those, and each shadow carries its own
 * `tokenMappings` so the TS textSpan returned by tsserver translates back
 * to the right source byte range.
 *
 * Returns `[]` when:
 *   - the source can't be compiled
 *   - the cursor lands outside any TokenMapping
 *   - tsserver has no definition (e.g. cursor on a literal)
 *   - the definition lives outside the .tu graph (e.g. inside `@tu/runtime`'s
 *     `.d.ts`) — we don't surface .ts internals as a goto target
 */
export function definitionAtTuPosition(
  source: string,
  filename: string,
  line: number,
  col: number
): TuDefinition[] {
  const rootAbsPath = isAbsolute(filename) ? filename : resolve(process.cwd(), filename)
  let shadows: Map<string, Shadow>
  try {
    shadows = buildShadowGraph(source, rootAbsPath)
  } catch {
    return []
  }
  const rootShadow = shadows.get(tuPathToTs(rootAbsPath))
  if (!rootShadow) return []

  const mapped = mapSourceLineColToTS(rootShadow.tokenMappings, rootShadow.tuSource, line, col)
  if (!mapped) return []

  const compilerOptions = getTuCompilerOptions()
  const service = ts.createLanguageService(
    createLsHost(shadows, rootShadow, compilerOptions),
    ts.createDocumentRegistry()
  )
  let defs: readonly ts.DefinitionInfo[] | undefined
  try {
    defs = service.getDefinitionAtPosition(rootShadow.virtualPath, mapped.tsOffset)
  } finally {
    service.dispose()
  }
  if (!defs || defs.length === 0) return []

  const out: TuDefinition[] = []
  for (const d of defs) {
    const targetShadow = shadows.get(d.fileName)
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

function createLsHost(
  shadows: Map<string, Shadow>,
  rootShadow: Shadow,
  compilerOptions: ts.CompilerOptions
): ts.LanguageServiceHost {
  return {
    getScriptFileNames: () => [rootShadow.virtualPath, ...shadows.keys()],
    getScriptVersion: () => '1',
    getScriptSnapshot: (name) => {
      const shadow = shadows.get(name)
      if (shadow) return ts.ScriptSnapshot.fromString(shadow.ts)
      const onDisk = ts.sys.readFile(name)
      if (onDisk === undefined) return undefined
      return ts.ScriptSnapshot.fromString(onDisk)
    },
    getCurrentDirectory: () => process.cwd(),
    getCompilationSettings: () => compilerOptions,
    getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
    fileExists: (name) => shadows.has(name) || ts.sys.fileExists(name),
    readFile: (name) => shadows.get(name)?.ts ?? ts.sys.readFile(name),
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  }
}

