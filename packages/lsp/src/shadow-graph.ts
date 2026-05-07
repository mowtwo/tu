import {
  canonicalizeShapes,
  classifyTopLevel,
  generateTSWithMap,
  inferBundleParamTypes,
  parse,
  tokenize,
  type CellKind,
  type CanonicalizeResult,
  type Program,
  type TokenMapping,
} from '@tu-lang/compiler'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { buildSourceMapper, decodeMappings } from './source-map.js'

/** `/path/Foo.tu` → `/path/Foo.ts` so the virtual path matches the import-rewrite codegen does. */
export function tuPathToTs(p: string): string {
  return p.endsWith('.tu') ? p.slice(0, -'.tu'.length) + '.ts' : p + '.ts'
}

/**
 * Workspace-internal Tu packages whose `.d.ts` should be resolved via a
 * direct path lookup instead of standard node_modules. This is purely a
 * monorepo-development convenience — without `paths` entries here, the
 * LSP would need every package built + symlinked into a node_modules
 * before any cross-package import resolves. Keeping the list explicit
 * (rather than auto-scanning `packages/*`) means we never accidentally
 * surface internal-only packages (compiler, lsp, vite, tu-shu) as
 * importable from user `.tu` files.
 *
 * Adding a new Tu platform package (e.g. `@tu-lang/node` once it lands)
 * is one entry in this list.
 *
 * Third-party platform packages do NOT need to be registered here —
 * `moduleResolution: "Bundler"` resolves them from the user's
 * node_modules just like a normal TS project would.
 */
export const TU_PLATFORM_PACKAGES: readonly string[] = [
  'runtime',
  'dom',
  'std',
  // future: 'node', 'workers', 'react-native-bridge', …
]

/** Locate `@tu-lang/runtime`'s `.d.ts` so the in-memory program can resolve the import. */
export function findRuntimeTypesPath(): string {
  return findSiblingPackageDts('runtime')
}

/** Locate `@tu-lang/dom`'s `.d.ts` for the same reason — Tu code that
 *  imports typed DOM wrappers / mount needs tsserver to resolve them. */
export function findDomTypesPath(): string {
  return findSiblingPackageDts('dom')
}

/** Generic resolver — caller passes the bare package name (the part
 *  after `@tu-lang/`). Used both by the named accessors above and by
 *  `getTuCompilerOptions` to build the `paths` map for every entry in
 *  `TU_PLATFORM_PACKAGES`. */
export function findSiblingPackageDts(pkgName: string): string {
  // From dist/shadow-graph.js → dist/ → packages/lsp/ → packages/ → repo/
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    resolve(here, '..', '..', pkgName, 'dist', 'index.d.ts'),
    resolve(here, '..', '..', '..', pkgName, 'dist', 'index.d.ts'),
    resolve(here, '..', '..', '..', '..', 'packages', pkgName, 'dist', 'index.d.ts'),
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  throw new Error(
    `@tu-lang/lsp could not locate @tu-lang/${pkgName} types (looked in ${candidates.join(', ')})`
  )
}

/**
 * Compiler options shared by the diagnostic ts.Program and the hover
 * LanguageService — we want both surfaces to see the exact same module /
 * strict / path settings, so factor it once.
 */
export function getTuCompilerOptions(): ts.CompilerOptions {
  // Build the platform-package `paths` map from the registry. Each
  // entry maps `@tu-lang/<name>` → its workspace `.d.ts`. Outside the
  // registry, imports flow through the standard Bundler resolver.
  const paths: Record<string, string[]> = {}
  for (const name of TU_PLATFORM_PACKAGES) {
    paths[`@tu-lang/${name}`] = [findSiblingPackageDts(name)]
  }
  return {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    // Tu's codegen rewrites cross-`.tu` imports to `.ts` paths in the TS
    // shadow (so tsserver resolves the sibling shadow). Permit them.
    allowImportingTsExtensions: true,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    // M6.10 platform-API split — runtime-function boundary is enforced
    // physically (mount/hydrate/defineCustomElement only live in
    // @tu-lang/dom). DOM lib stays ambient for now so user code that
    // *does* opt into the DOM (anything imported from @tu-lang/dom)
    // gets methods like `el.appendChild` resolved without us having to
    // ship our own DOM type forks. Strict type-level isolation (no
    // ambient `document`/`Event`) is tracked in DEFERRED.tu.
    paths,
  }
}

export interface Shadow {
  /** Absolute virtual TS path (foo.ts) — what tsserver resolves imports to. */
  virtualPath: string
  /** Absolute path of the original .tu source. */
  tuPath: string
  /** Compiled TS source. */
  ts: string
  /** Original .tu source — needed to convert source byte offsets to line/col. */
  tuSource: string
  /** Source map for translating tsserver diagnostics back to .tu line/col. */
  mappings: ReturnType<typeof decodeMappings>
  /** Pre-built mapping function (per-statement, used as the fallback). */
  mapPos: (genLine: number, genCol: number) => { line: number; col: number }
  /** Per-token spans — drives token-level diagnostic ranges. */
  tokenMappings: TokenMapping[]
  /** The parsed AST — kept around for downstream LSP features that
   *  need to inspect interface decls (M9 hover expansion + goto-def
   *  for type names). Drops trivially small overhead vs. re-parsing. */
  ast: Program
  /** Cross-file canonical shape merge data. Shared by every shadow in
   *  a graph; used by hover to explain same-shape interface merges. */
  canonical: CanonicalizeResult
}

interface ParsedFile {
  source: string
  filename: string
  ast: Program
}

/**
 * Walk the import graph rooted at `(rootSource, rootFilename)`, compile every
 * reachable `.tu` to a TS shadow, and return the closure as a Map keyed by
 * the shadow's virtual path.
 *
 * Two phases:
 *   1. BFS-parse every reachable file and record its direct `export let`
 *      kinds (state / computed / function).
 *   2. Compile each file with `importedNameKinds` derived from its
 *      `ImportDecl`s + the cross-file export map. This fixes the M2.1
 *      reactivity bug where importing a Signal cell silently dropped
 *      `.get()` injection because the compiler couldn't tell its kind.
 *
 * `inMemorySources` (optional, M6.12): a map of absolute `.tu` paths → source
 * text from the editor's open documents. When the BFS encounters an import
 * whose target absolute path appears in this map, it reads from there
 * instead of `readFileSync`. This lets the LSP see live edits to ANY open
 * `.tu` file, not just the root being analyzed — fixing the previous
 * "edit Card.tu, hover in App.tu shows stale results" gap.
 */
export function buildShadowGraph(
  rootSource: string,
  rootFilename: string,
  inMemorySources?: ReadonlyMap<string, string>
): Map<string, Shadow> {
  const parsed = bfsParseGraph(rootSource, rootFilename, inMemorySources)
  const exportKinds = collectDirectExportKinds(parsed)
  const exportedInterfaces = collectExportedInterfaceNames(parsed)
  const programs = new Map<string, Program>()
  for (const [filename, file] of parsed) programs.set(filename, file.ast)
  const inferredParamTypesByFile = inferBundleParamTypes(programs)
  const canonical = canonicalizeShapes(programs)
  const shadows = new Map<string, Shadow>()
  for (const file of parsed.values()) {
    const importedNameKinds = buildImportedNameKinds(file, exportKinds)
    const importedInterfaceNames = buildImportedInterfaceNames(file, exportedInterfaces)
    let compiled
    try {
      compiled = generateTSWithMap(file.ast, file.source, file.filename, {
        ...(importedNameKinds ? { importedNameKinds } : {}),
        ...(importedInterfaceNames ? { importedInterfaceNames } : {}),
        ...(inferredParamTypesByFile.get(file.filename)
          ? { inferredParamTypes: inferredParamTypesByFile.get(file.filename) }
          : {}),
      })
    } catch {
      // Should not happen — bfsParseGraph already proved this file parses.
      // Defensive skip; downstream sees no shadow and behaves as before.
      continue
    }
    const virtualPath = tuPathToTs(file.filename)
    shadows.set(virtualPath, {
      virtualPath,
      tuPath: file.filename,
      ts: compiled.code,
      tuSource: file.source,
      mappings: decodeMappings(compiled.map.mappings),
      mapPos: buildSourceMapper(compiled.map),
      tokenMappings: compiled.tokenMappings,
      ast: file.ast,
      canonical,
    })
  }
  return shadows
}

/**
 * BFS over the import graph; parse every reachable `.tu`. Files that fail
 * to parse are dropped (the eventual diagnostics flow surfaces the syntax
 * error when the user opens that file directly).
 *
 * For each import target the BFS first checks `inMemorySources` (M6.12 —
 * the editor's open-document store) so live edits across files participate
 * in cross-module type analysis without needing to save to disk.
 */
function bfsParseGraph(
  rootSource: string,
  rootFilename: string,
  inMemorySources?: ReadonlyMap<string, string>
): Map<string, ParsedFile> {
  const out = new Map<string, ParsedFile>()
  const queue: { source: string; filename: string }[] = [
    { source: rootSource, filename: rootFilename },
  ]
  const seen = new Set<string>()
  while (queue.length > 0) {
    const { source, filename } = queue.shift()!
    if (seen.has(filename)) continue
    seen.add(filename)
    let ast: Program
    try {
      ast = parse(tokenize(source, filename), source, filename)
    } catch {
      continue
    }
    out.set(filename, { source, filename, ast })
    for (const stmt of ast.body) {
      if (stmt.kind !== 'ImportDecl' && stmt.kind !== 'ReExportDecl') continue
      if (!stmt.source.endsWith('.tu')) continue
      if (!stmt.source.startsWith('.')) continue
      const importPath = resolve(dirname(filename), stmt.source)
      if (seen.has(importPath)) continue
      const inMemory = inMemorySources?.get(importPath)
      if (inMemory !== undefined) {
        queue.push({ source: inMemory, filename: importPath })
        continue
      }
      try {
        const importedSource = readFileSync(importPath, 'utf-8')
        queue.push({ source: importedSource, filename: importPath })
      } catch {
        // missing / unreadable — diagnostic flow handles it
      }
    }
  }
  return out
}

/**
 * For each parsed file, classify its DIRECT `export let` bindings (state /
 * computed / function). Re-exports (`export { X } from "./other.tu"`) and
 * transitive chains are intentionally not chased — V1 fix covers the
 * common case (direct import of a sibling cell). Multi-hop re-exports
 * still fall back to `'function'`, identical to pre-M2.3 behavior.
 */
function collectDirectExportKinds(
  parsed: Map<string, ParsedFile>
): Map<string, Map<string, CellKind>> {
  const out = new Map<string, Map<string, CellKind>>()
  for (const [filename, file] of parsed) {
    const exports = new Map<string, CellKind>()
    for (const stmt of file.ast.body) {
      if (stmt.kind === 'LetDecl' && stmt.exported) {
        const kind = classifyTopLevel(stmt.value)
        exports.set(stmt.name, kind)
        if (stmt.default) exports.set('default', kind)
      }
    }
    out.set(filename, exports)
  }
  return out
}

/**
 * For each parsed file, collect the set of names declared via
 * `export interface X { … }`. Used by Phase 3c (M8) so cross-`.tu`
 * imported interface annotations also tag their typed-let sites.
 */
function collectExportedInterfaceNames(
  parsed: Map<string, ParsedFile>
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const [filename, file] of parsed) {
    const interfaces = new Set<string>()
    for (const stmt of file.ast.body) {
      if (stmt.kind === 'InterfaceDecl' && stmt.exported) {
        interfaces.add(stmt.name)
      }
    }
    out.set(filename, interfaces)
  }
  return out
}

/**
 * Build the `importedInterfaceNames` set for a single importing file by
 * walking its `ImportDecl`s and looking each imported name up in the
 * exporting file's interface set. Returns `undefined` if no imports
 * resolve to interfaces — codegen's option-typing wants undefined for
 * "skip this option" rather than an empty set.
 */
function buildImportedInterfaceNames(
  file: ParsedFile,
  exportedInterfaces: Map<string, Set<string>>
): Set<string> | undefined {
  let result: Set<string> | undefined
  for (const stmt of file.ast.body) {
    if (stmt.kind !== 'ImportDecl') continue
    if (!stmt.source.endsWith('.tu') || !stmt.source.startsWith('.')) continue
    const importPath = resolve(dirname(file.filename), stmt.source)
    const targetInterfaces = exportedInterfaces.get(importPath)
    if (!targetInterfaces) continue
    for (const name of stmt.names) {
      if (!targetInterfaces.has(name)) continue
      if (!result) result = new Set()
      result.add(name)
    }
  }
  return result
}

/**
 * Build the `importedNameKinds` map for a single importing file by walking
 * its `ImportDecl`s and looking each name up in the cross-file export
 * table. Names that we can't resolve (file not in graph, name not exported)
 * fall through and the compiler defaults them to `'function'`.
 */
function buildImportedNameKinds(
  file: ParsedFile,
  exportKinds: Map<string, Map<string, CellKind>>
): Map<string, CellKind> | undefined {
  let result: Map<string, CellKind> | undefined
  for (const stmt of file.ast.body) {
    if (stmt.kind !== 'ImportDecl') continue
    if (!stmt.source.endsWith('.tu') || !stmt.source.startsWith('.')) continue
    const importPath = resolve(dirname(file.filename), stmt.source)
    const targetExports = exportKinds.get(importPath)
    if (!targetExports) continue
    for (const name of stmt.names) {
      const kind = targetExports.get(name)
      if (kind === undefined) continue
      if (!result) result = new Map()
      result.set(name, kind)
    }
    if (stmt.default !== undefined) {
      const kind = targetExports.get('default')
      if (kind !== undefined) {
        if (!result) result = new Map()
        result.set(stmt.default, kind)
      }
    }
  }
  return result
}
