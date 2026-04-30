import { compileToTSWithMap, parse, tokenize, type Program, type TokenMapping } from '@tu/compiler'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { buildSourceMapper, decodeMappings, mapTSRangeToSource } from './source-map.js'

export interface TuDiagnostic {
  /** 0-based line in the .tu source. */
  line: number
  /** 0-based column in the .tu source. */
  col: number
  /** Diagnostic length in `.tu` source bytes (not TS) — squiggle width. */
  length: number
  severity: 'error' | 'warning' | 'info' | 'hint'
  message: string
  /** TS error code (e.g. 2322), surfaced for diagnostic.code in the LSP. */
  code: number
}

/** `/path/Foo.tu` → `/path/Foo.ts` so the virtual path matches the import-rewrite codegen does. */
function tuPathToTs(p: string): string {
  return p.endsWith('.tu') ? p.slice(0, -'.tu'.length) + '.ts' : p + '.ts'
}

/** Locate `@tu/runtime`'s `.d.ts` so the in-memory program can resolve the import. */
function findRuntimeTypesPath(): string {
  // From dist/diagnostics.js → dist/ → packages/lsp/ → packages/ → repo/
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

interface Shadow {
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
function buildShadowGraph(rootSource: string, rootFilename: string): Map<string, Shadow> {
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

/**
 * Type-check a single `.tu` source against its full import graph. The current
 * document's text is used verbatim; transitively-imported `.tu` files are
 * read from disk. Returns diagnostics for the root file only (cross-file
 * errors land in the file that imports the broken thing).
 *
 * V1 limitations:
 * - In-memory edits to non-root files are NOT seen — this only resolves
 *   through the disk for transitive deps. Open multiple files in VS Code
 *   and switching between them re-runs from disk every time. Acceptable
 *   for the smoke-test scale; future work for incremental.
 * - Per-statement source-map granularity, so a diagnostic shows up at the
 *   start of the offending `let` / `import` line, not pointed at the exact
 *   token.
 */
export function checkTuSource(source: string, filename: string): TuDiagnostic[] {
  // Normalize filename to absolute up-front so the BFS keys + the root
  // lookup agree (the BFS uses whatever filename it's given verbatim).
  const rootAbsPath = isAbsolute(filename) ? filename : resolve(process.cwd(), filename)
  let shadows: Map<string, Shadow>
  try {
    shadows = buildShadowGraph(source, rootAbsPath)
  } catch (err) {
    // A Tu compile error on the ROOT file (the one being checked) surfaces
    // here. The error is already pre-formatted with file:line:col by M1.9.
    return [
      {
        line: 0,
        col: 0,
        length: 1,
        severity: 'error',
        message: err instanceof Error ? err.message : String(err),
        code: -1,
      },
    ]
  }
  const rootVirtualPath = tuPathToTs(rootAbsPath)
  const rootShadow = shadows.get(rootVirtualPath)
  if (!rootShadow) {
    // The root failed to compile inside buildShadowGraph (caught silently
    // there). Re-run compile so we can surface the formatted error.
    try {
      compileToTSWithMap(source, { filename })
    } catch (err) {
      return [
        {
          line: 0,
          col: 0,
          length: 1,
          severity: 'error',
          message: err instanceof Error ? err.message : String(err),
          code: -1,
        },
      ]
    }
    return []
  }
  const runtimeTypes = findRuntimeTypesPath()

  const compilerOptions: ts.CompilerOptions = {
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
      '@tu/runtime': [runtimeTypes],
    },
  }

  const host = ts.createCompilerHost(compilerOptions, true)
  const realGetSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => {
    const shadow = shadows.get(name)
    if (shadow) {
      return ts.createSourceFile(name, shadow.ts, languageVersion, true)
    }
    return realGetSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile)
  }
  const realFileExists = host.fileExists.bind(host)
  host.fileExists = (name) => shadows.has(name) || realFileExists(name)
  const realReadFile = host.readFile.bind(host)
  host.readFile = (name) => shadows.get(name)?.ts ?? realReadFile(name)

  const program = ts.createProgram({
    rootNames: [rootShadow.virtualPath],
    options: compilerOptions,
    host,
  })

  const tsDiagnostics = ts.getPreEmitDiagnostics(program)
  return tsDiagnostics
    .filter((d) => d.file?.fileName === rootShadow.virtualPath)
    .map((d) => translateDiagnostic(d, rootShadow))
}

function translateDiagnostic(d: ts.Diagnostic, shadow: Shadow): TuDiagnostic {
  const start = d.start ?? 0
  const length = d.length ?? 1
  // Token-level mapping: if a TokenMapping covers the diagnostic's TS span,
  // use that span's source range. Otherwise fall back to the per-statement
  // mapping (start point) and let the LSP layer expand it to the let header.
  const range = mapTSRangeToSource(
    shadow.tokenMappings,
    shadow.ts,
    shadow.tuSource,
    start,
    length,
    shadow.mapPos
  )
  return {
    line: range.line,
    col: range.col,
    length: range.length,
    severity:
      d.category === ts.DiagnosticCategory.Error
        ? 'error'
        : d.category === ts.DiagnosticCategory.Warning
          ? 'warning'
          : d.category === ts.DiagnosticCategory.Suggestion
            ? 'hint'
            : 'info',
    message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
    code: d.code,
  }
}

// Convenience: read .tu off disk and check.
export function checkTuFile(path: string): TuDiagnostic[] {
  const source = readFileSync(path, 'utf-8')
  return checkTuSource(source, path)
}
