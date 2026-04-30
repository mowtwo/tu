import { compileToTSWithMap, parse, tokenize, type Program, type TokenMapping } from '@tu/compiler'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { buildSourceMapper, decodeMappings } from './source-map.js'

/** `/path/Foo.tu` → `/path/Foo.ts` so the virtual path matches the import-rewrite codegen does. */
export function tuPathToTs(p: string): string {
  return p.endsWith('.tu') ? p.slice(0, -'.tu'.length) + '.ts' : p + '.ts'
}

/** Locate `@tu/runtime`'s `.d.ts` so the in-memory program can resolve the import. */
export function findRuntimeTypesPath(): string {
  // From dist/shadow-graph.js → dist/ → packages/lsp/ → packages/ → repo/
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    resolve(here, '..', '..', 'runtime', 'dist', 'index.d.ts'),
    resolve(here, '..', '..', '..', 'runtime', 'dist', 'index.d.ts'),
    resolve(here, '..', '..', '..', '..', 'packages', 'runtime', 'dist', 'index.d.ts'),
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  throw new Error(
    `@tu/lsp could not locate @tu/runtime types (looked in ${candidates.join(', ')})`
  )
}

/**
 * Compiler options shared by the diagnostic ts.Program and the hover
 * LanguageService — we want both surfaces to see the exact same module /
 * strict / path settings, so factor it once.
 */
export function getTuCompilerOptions(): ts.CompilerOptions {
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
    paths: {
      '@tu/runtime': [findRuntimeTypesPath()],
    },
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
}

/**
 * Walk the import graph rooted at `(rootSource, rootFilename)`, compile every
 * reachable `.tu` to a TS shadow, and return the closure as a Map keyed by
 * the shadow's virtual path. The root is included; transitively imported
 * `.tu` files are read from disk (in-memory edits to OTHER files are not
 * picked up — V2 will surface them by routing through the LSP's open-doc
 * cache).
 *
 * Files we can't read (missing, permission denied) are skipped silently;
 * tsserver will produce its own "Cannot find module" diagnostic mapped to
 * the import line.
 */
export function buildShadowGraph(rootSource: string, rootFilename: string): Map<string, Shadow> {
  const shadows = new Map<string, Shadow>()
  const queue: { source: string; filename: string }[] = [
    { source: rootSource, filename: rootFilename },
  ]
  const seen = new Set<string>()
  while (queue.length > 0) {
    const { source, filename } = queue.shift()!
    if (seen.has(filename)) continue
    seen.add(filename)
    let compiled
    let ast: Program
    try {
      compiled = compileToTSWithMap(source, { filename })
      ast = parse(tokenize(source, filename), source, filename)
    } catch {
      // A Tu compile error in an imported module short-circuits its analysis,
      // but doesn't tank the whole LSP — the importer will still be checked,
      // and tsserver will emit "cannot find module" if the broken file's
      // exports aren't reachable. The compile error itself surfaces when the
      // user opens that broken file directly.
      continue
    }
    const virtualPath = tuPathToTs(filename)
    shadows.set(virtualPath, {
      virtualPath,
      tuPath: filename,
      ts: compiled.code,
      tuSource: source,
      mappings: decodeMappings(compiled.map.mappings),
      mapPos: buildSourceMapper(compiled.map),
      tokenMappings: compiled.tokenMappings,
    })

    // Walk top-level imports + re-exports for relative `.tu` paths.
    for (const stmt of ast.body) {
      if (stmt.kind !== 'ImportDecl' && stmt.kind !== 'ReExportDecl') continue
      if (!stmt.source.endsWith('.tu')) continue
      // Only follow relative paths — bare-specifier imports are npm modules
      // resolved by tsserver against node_modules, not part of our graph.
      if (!stmt.source.startsWith('.')) continue
      const importPath = resolve(dirname(filename), stmt.source)
      if (seen.has(importPath)) continue
      try {
        const importedSource = readFileSync(importPath, 'utf-8')
        queue.push({ source: importedSource, filename: importPath })
      } catch {
        // missing / unreadable — let tsserver complain at the import site
      }
    }
  }
  return shadows
}
