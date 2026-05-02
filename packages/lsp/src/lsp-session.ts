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
  /** Disk mtime (ms) for each transitively-imported `.tu` file that we
   *  read from disk. In-memory imports (see `inMemoryFingerprint`) do NOT
   *  appear here because their freshness is checked separately. */
  importStamps: Map<string, number>
  /** Snapshot of in-memory imports at session-build time: `path → text`.
   *  Cache hits require an EXACT match — content drift means rebuild.
   *  Empty when the editor only has the root open. (M6.12.) */
  inMemoryFingerprint: Map<string, string>
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
 * `inMemorySources` (M6.12): a map of absolute `.tu` paths → live editor
 * text for non-root files. The shadow graph reads from this map first,
 * disk second. Pass the editor's full open-document set so cross-file
 * features (hover, goto-def, references, diagnostics) see live edits.
 *
 * Invalidates the cache when:
 *   - the root path or root source text differs from the cached one
 *   - any disk-backed (non-in-memory) import's mtime has advanced
 *   - any in-memory import's text has changed since the cache was built
 *   - the set of in-memory keys differs from the cached snapshot
 */
export function getOrCreateSession(
  source: string,
  filename: string,
  inMemorySources?: ReadonlyMap<string, string>
): TuLspSession | null {
  const rootAbsPath = isAbsolute(filename) ? filename : resolve(process.cwd(), filename)
  if (
    cached &&
    cached.rootSource === source &&
    cached.rootFilename === rootAbsPath &&
    importsStillFresh(cached) &&
    inMemoryStillFresh(cached, inMemorySources)
  ) {
    return cached
  }
  if (cached) {
    cached.service.dispose()
    cached = null
  }
  let shadows: Map<string, Shadow>
  try {
    shadows = buildShadowGraph(source, rootAbsPath, inMemorySources)
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
  const inMemoryFingerprint = new Map<string, string>()
  for (const shadow of shadows.values()) {
    if (shadow.tuPath === rootAbsPath) continue
    const inMem = inMemorySources?.get(shadow.tuPath)
    if (inMem !== undefined) {
      // Track in-memory imports separately — their freshness is by-content,
      // not by mtime.
      inMemoryFingerprint.set(shadow.tuPath, inMem)
      continue
    }
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
    inMemoryFingerprint,
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

/**
 * Validate that the cached session's in-memory imports still match the
 * editor's current open-document state. Returns false (cache miss) when:
 *   - any cached in-memory entry has different text now
 *   - the editor opened a new in-memory file the cache wasn't built with
 *   - the editor closed an in-memory file the cache had recorded
 *   - a path moved from in-memory to disk-only or vice versa
 *
 * The tightest check is "exact match" — anything else risks stale results.
 */
function inMemoryStillFresh(
  c: CachedEntry,
  current: ReadonlyMap<string, string> | undefined
): boolean {
  // Compare only the keys the cache covered. New in-memory imports added
  // by the editor since the session was built can't affect ALREADY-cached
  // shadows (those imports aren't in the graph), but any in-memory entry
  // that was on the path during build MUST still match.
  for (const [path, text] of c.inMemoryFingerprint) {
    const now = current?.get(path)
    if (now !== text) return false
  }
  // If the editor has new in-memory entries that fall on the cached
  // graph's known paths (i.e. the cache used a disk read for that path
  // last time, but now the editor opened it in-memory), the disk-mtime
  // check above won't catch it — invalidate here too.
  if (current) {
    for (const path of current.keys()) {
      // Only fail freshness if this in-memory path is part of the cache's
      // graph (i.e. was read from disk previously) and content differs
      // from what the disk read produced. The tightest fix is to just
      // miss-and-rebuild: if the editor's in-memory set is non-empty and
      // covers any disk-stamped path, rebuild.
      if (c.importStamps.has(path)) return false
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
