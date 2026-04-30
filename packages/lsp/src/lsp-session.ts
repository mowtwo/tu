import { statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import ts from 'typescript'
import {
  buildShadowGraph,
  getTuCompilerOptions,
  tuPathToTs,
  type Shadow,
} from './shadow-graph.js'

export interface TuLspSession {
  shadows: Map<string, Shadow>
  rootShadow: Shadow
  service: ts.LanguageService
}

interface CachedEntry extends TuLspSession {
  /** Verbatim root source text — cache hits require an exact match. */
  rootSource: string
  /** Absolute path of the root `.tu` file. */
  rootFilename: string
  /** Disk mtime (ms) for each transitively-imported `.tu` file. Empty when
   *  the root has no imports. Used to invalidate the cache when an imported
   *  file changes on disk (the in-memory editor only owns the root). */
  importStamps: Map<string, number>
}

/**
 * Single-slot cache: the most recent `(rootFilename, rootSource)` pair, plus
 * the import-graph mtimes when the session was built. Rebuilt on miss.
 *
 * Multi-slot LRU is a future optimization; for the common interactive loop
 * (hover, then completion, then definition on the same file) one slot is
 * enough to skip the BFS + Program rebuild on every keystroke-paused query.
 */
let cached: CachedEntry | null = null

/**
 * Look up or build the LSP session for `(source, filename)`. Returns `null`
 * when the source can't be Tu-compiled into a root shadow (broken syntax —
 * the LSP layer surfaces that via diagnostics; hover/completion/definition
 * just return empty).
 *
 * Invalidates the cache when:
 *   - the root path or root source text differs from the cached one
 *   - any transitively-imported `.tu` file's mtime has advanced on disk
 */
export function getOrCreateSession(source: string, filename: string): TuLspSession | null {
  const rootAbsPath = isAbsolute(filename) ? filename : resolve(process.cwd(), filename)
  if (
    cached &&
    cached.rootSource === source &&
    cached.rootFilename === rootAbsPath &&
    importsStillFresh(cached)
  ) {
    return cached
  }
  if (cached) {
    cached.service.dispose()
    cached = null
  }
  let shadows: Map<string, Shadow>
  try {
    shadows = buildShadowGraph(source, rootAbsPath)
  } catch {
    return null
  }
  const rootShadow = shadows.get(tuPathToTs(rootAbsPath))
  if (!rootShadow) return null
  const compilerOptions = getTuCompilerOptions()
  const service = ts.createLanguageService(
    createLsHost(shadows, rootShadow, compilerOptions),
    ts.createDocumentRegistry()
  )
  const importStamps = new Map<string, number>()
  for (const shadow of shadows.values()) {
    if (shadow.tuPath === rootAbsPath) continue
    try {
      importStamps.set(shadow.tuPath, statSync(shadow.tuPath).mtimeMs)
    } catch {
      // unreadable — skip; if it disappears later we'll detect via the
      // freshness check (statSync throws → return false → invalidate).
    }
  }
  cached = {
    rootSource: source,
    rootFilename: rootAbsPath,
    importStamps,
    shadows,
    rootShadow,
    service,
  }
  return cached
}

/**
 * Dispose the cached session, if any. Tests use this to keep one another
 * isolated; in production the runtime tears it down on process exit.
 */
export function disposeSessionCache(): void {
  if (cached) {
    cached.service.dispose()
    cached = null
  }
}

function importsStillFresh(c: CachedEntry): boolean {
  for (const [path, mtime] of c.importStamps) {
    try {
      const cur = statSync(path).mtimeMs
      if (cur !== mtime) return false
    } catch {
      return false
    }
  }
  return true
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
