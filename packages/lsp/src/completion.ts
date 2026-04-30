import { isAbsolute, resolve } from 'node:path'
import ts from 'typescript'
import { mapSourceLineColToTS } from './source-map.js'
import {
  buildShadowGraph,
  getTuCompilerOptions,
  tuPathToTs,
  type Shadow,
} from './shadow-graph.js'

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
 * Resolve completions for a `(line, col)` cursor position in a `.tu` source.
 * Mirrors `hoverAtTuPosition` plumbing — same shadow graph, same compiler
 * options, same one-shot LanguageService — but calls
 * `getCompletionsAtPosition` and post-processes each entry.
 *
 * Returns `[]` (not `null`) when no completions are available; the LSP layer
 * converts an empty list into a no-op response. We don't enrich entries with
 * full details up-front (TS exposes `getCompletionEntryDetails` for that);
 * the LSP can lazily resolve via `completionItem/resolve` later.
 */
export function completionsAtTuPosition(
  source: string,
  filename: string,
  line: number,
  col: number
): TuCompletionItem[] {
  const rootAbsPath = isAbsolute(filename) ? filename : resolve(process.cwd(), filename)
  let shadows: Map<string, Shadow>
  try {
    shadows = buildShadowGraph(source, rootAbsPath)
  } catch {
    return []
  }
  const rootShadow = shadows.get(tuPathToTs(rootAbsPath))
  if (!rootShadow) return []

  // Inclusive-end mapping: completion is most useful at the cursor sitting
  // right past the last char of an identifier the user just typed.
  const mapped = mapSourceLineColToTS(
    rootShadow.tokenMappings,
    rootShadow.tuSource,
    line,
    col,
    { inclusiveEnd: true }
  )
  if (!mapped) return []

  const compilerOptions = getTuCompilerOptions()
  const service = ts.createLanguageService(
    createLsHost(shadows, rootShadow, compilerOptions),
    ts.createDocumentRegistry()
  )
  let info: ts.WithMetadata<ts.CompletionInfo> | undefined
  try {
    info = service.getCompletionsAtPosition(rootShadow.virtualPath, mapped.tsOffset, {})
  } finally {
    service.dispose()
  }
  if (!info) return []
  return info.entries.map((e) => ({
    label: e.name,
    kind: e.kind,
    sortText: e.sortText,
    ...(e.insertText !== undefined ? { insertText: e.insertText } : {}),
  }))
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
