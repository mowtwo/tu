import { compileToTSWithMap, parse, tokenize } from '@tu-lang/compiler'
import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import ts from 'typescript'
import { validateCssBlocks } from './css-lsp.js'
import { mapTSRangeToSource } from './source-map.js'
import {
  buildShadowGraph,
  getTuCompilerOptions,
  tuPathToTs,
  type Shadow,
} from './shadow-graph.js'

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
  const compilerOptions = getTuCompilerOptions()

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
  const tuDiags: TuDiagnostic[] = tsDiagnostics
    .filter((d) => d.file?.fileName === rootShadow.virtualPath)
    .map((d) => translateDiagnostic(d, rootShadow))

  // Augment with CSS diagnostics from any style blocks in the root file.
  // The checked source is the in-memory text we received, not the
  // shadow-graph copy on disk — keeps things consistent with what tsc saw.
  try {
    const ast = parse(tokenize(source, filename), source, filename)
    for (const cssDiag of validateCssBlocks(source, ast)) {
      tuDiags.push({
        line: cssDiag.line,
        col: cssDiag.col,
        length: cssDiag.length,
        severity: cssDiag.severity,
        message: cssDiag.message,
        // CSS LS doesn't carry TS-style numeric codes; surface a sentinel
        // so the LSP layer can suppress the `[code]` tag in its output.
        code: -1,
      })
    }
  } catch {
    // Already covered by the buildShadowGraph compile-error path above.
  }

  return tuDiags
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
