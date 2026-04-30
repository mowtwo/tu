import { compileToTSWithMap } from '@tu/compiler'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { buildSourceMapper, type MappingSegment } from './source-map.js'
import { decodeMappings } from './source-map.js'

export interface TuDiagnostic {
  /** 0-based line in the .tu source. */
  line: number
  /** 0-based column in the .tu source. */
  col: number
  /** Diagnostic length in TS characters; mapped 1:1 since per-statement granularity. */
  length: number
  severity: 'error' | 'warning' | 'info' | 'hint'
  message: string
  /** TS error code (e.g. 2322), surfaced for diagnostic.code in the LSP. */
  code: number
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

/**
 * Type-check a single `.tu` source. Returns diagnostics with positions
 * mapped back to .tu line/col coordinates. Uses TypeScript's in-process
 * compiler API — no spawning, sub-second on small modules.
 *
 * V1 limitations:
 * - Single-file analysis; cross-`.tu` imports are not resolved through
 *   the LSP (the user sees a cannot-find-module error if they import
 *   from another `.tu`). M3 V2 work.
 * - Per-statement source-map granularity, so a diagnostic shows up at
 *   the start of the offending `let` / `import` line, not pointed at
 *   the exact token.
 */
export function checkTuSource(source: string, filename: string): TuDiagnostic[] {
  let tsResult
  try {
    tsResult = compileToTSWithMap(source, { filename })
  } catch (err) {
    // A compile-side syntax error already carries `file:line:col` in its
    // message thanks to M1.9. Surface it as a single diagnostic at line 0.
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
  const { code: virtualTs, map } = tsResult
  const segments = decodeMappings(map.mappings)
  const mapPos = buildSourceMapper(map)

  const virtualPath = isAbsolute(filename) ? filename + '.ts' : resolve(process.cwd(), filename) + '.ts'
  const runtimeTypes = findRuntimeTypesPath()

  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
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
    if (name === virtualPath) {
      return ts.createSourceFile(name, virtualTs, languageVersion, true)
    }
    return realGetSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile)
  }
  const realFileExists = host.fileExists.bind(host)
  host.fileExists = (name) => name === virtualPath || realFileExists(name)
  const realReadFile = host.readFile.bind(host)
  host.readFile = (name) => (name === virtualPath ? virtualTs : realReadFile(name))

  const program = ts.createProgram({
    rootNames: [virtualPath],
    options: compilerOptions,
    host,
  })

  const tsDiagnostics = ts.getPreEmitDiagnostics(program)
  return tsDiagnostics
    .filter((d) => d.file?.fileName === virtualPath)
    .map((d) => translateDiagnostic(d, segments, mapPos))
}

function translateDiagnostic(
  d: ts.Diagnostic,
  _segments: MappingSegment[],
  mapPos: (genLine: number, genCol: number) => { line: number; col: number }
): TuDiagnostic {
  const start = d.start ?? 0
  const length = d.length ?? 1
  const file = d.file
  const { line: genLine, character: genCol } = file
    ? file.getLineAndCharacterOfPosition(start)
    : { line: 0, character: 0 }
  const mapped = mapPos(genLine, genCol)
  return {
    line: mapped.line,
    col: mapped.col,
    length,
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
