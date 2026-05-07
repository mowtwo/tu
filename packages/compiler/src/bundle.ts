// M8 Phase 6b/6c — `compileBundle()`, the orchestrator that turns
// per-file Tu code into:
//
//   1. A shared `__tu_types.generated.ts` module containing every
//      canonical descriptor across the build root.
//   2. Per-file outputs whose interface decls + anon synth references
//      import from the shared module instead of redeclaring locally.
//
// This is the user-visible payoff of Phase 6: shapes are merged
// once per build, bundle size shrinks, runtime descriptor identity
// is stable across files (`type.of(x) === type.of(y)` for same
// shapes).
//
// The standalone `compile()` / `compileToTS()` paths stay unchanged —
// they emit local descriptors as before. Build tools (CLI / vite
// plugin / LSP) opt into bundle mode when they have multiple files
// in scope.

import { canonicalizeShapes, type CanonicalDescriptor } from './canonicalize.js'
import { generateTSWithMap, generateWithMap, inferBundleParamTypes } from './codegen.js'
import { tokenize } from './lexer.js'
import { parse } from './parser.js'
import type { CompileResult } from './index.js'
import type { Program } from './ast.js'

export interface BundleInput {
  /** Absolute or relative path used for source maps + canonical key resolution. */
  filename: string
  /** Verbatim Tu source text. */
  source: string
}

export interface BundleResult {
  /**
   * Per-file compile outputs, keyed by `filename`. Each preserves the
   * shape of `compile()` / `compileToTS()` result (code + map +
   * tokenMappings) so consumers can write each file's output to disk
   * without further processing.
   */
  files: Map<string, CompileResult>
  /**
   * The shared canonical descriptor module. The build tool should
   * emit this at `sharedModulePath` (typically beside the per-file
   * outputs, with the relative-path imports the per-file outputs
   * already use).
   */
  sharedModule: { path: string; code: string }
  /** The canonicalize result, exposed for tooling that wants to inspect
   *  the merge (debug rendering, build reports, etc.). */
  canonical: ReturnType<typeof canonicalizeShapes>
}

export interface BundleOptions {
  /**
   * Module specifier per-file outputs use to import the shared
   * descriptor module. Defaults to `'./__tu_types.generated.ts'` —
   * suitable when shared module + per-file outputs sit in the same
   * dir. Build tools that route outputs through different paths
   * (e.g. vite's HMR transform layer) override this.
   */
  sharedImportPath?: string
  /**
   * Relative path the orchestrator uses to write the shared module.
   * Defaults to `__tu_types.generated.ts`. Doesn't have to match
   * `sharedImportPath` (the importer may use `./` prefix and the
   * disk path may not).
   */
  sharedOutputPath?: string
  /** Emit TypeScript (preserves type annotations) when true; JS otherwise. */
  emitTS?: boolean
}

/**
 * Bundle-mode compile: takes N inputs, runs canonicalize + per-file
 * emit with canonical-name rewriting, returns per-file outputs + a
 * shared module the build tool writes once.
 */
export function compileBundle(
  inputs: ReadonlyArray<BundleInput>,
  options: BundleOptions = {}
): BundleResult {
  const sharedImportPath = options.sharedImportPath ?? './__tu_types.generated.ts'
  const sharedOutputPath = options.sharedOutputPath ?? '__tu_types.generated.ts'
  const emitTS = options.emitTS ?? false

  // Phase 1 — parse every input.
  const programs = new Map<string, Program>()
  for (const input of inputs) {
    const tokens = tokenize(input.source, input.filename)
    const ast = parse(tokens, input.source, input.filename)
    programs.set(input.filename, ast)
  }

  // Phase 2 — canonicalize across the whole bundle.
  const canonical = canonicalizeShapes(programs)
  const inferredParamTypesByFile = inferBundleParamTypes(programs)

  // Phase 3 — emit each file with the per-file canonical map injected.
  const files = new Map<string, CompileResult>()
  for (const input of inputs) {
    const ast = programs.get(input.filename)!
    const canonicalNamesForFile = canonical.perFile.get(input.filename) ?? new Map()
    const compileOptions = {
      filename: input.filename,
      canonicalNamesForFile,
      canonicalImportPath: sharedImportPath,
      inferredParamTypes: inferredParamTypesByFile.get(input.filename),
    }
    const result = emitTS
      ? generateTSWithMap(ast, input.source, input.filename, compileOptions)
      : generateWithMap(ast, input.source, input.filename, compileOptions)
    files.set(input.filename, result)
  }

  // Phase 4 — emit the shared canonical module.
  const sharedCode = renderSharedModule(canonical.descriptors, emitTS)

  return {
    files,
    sharedModule: { path: sharedOutputPath, code: sharedCode },
    canonical,
  }
}

/**
 * Render the shared canonical descriptor module — one `export const T_HASH = type.struct(…)`
 * per merged shape. Also stamps a header comment listing every origin
 * (file + name) for build-output traceability.
 */
function renderSharedModule(
  descriptors: ReadonlyArray<CanonicalDescriptor>,
  emitTS: boolean
): string {
  const lines: string[] = []
  lines.push('// Generated by @tu-lang/compiler — M8 Phase 6 canonical descriptors.')
  lines.push('// Do not edit: regenerated on every build from the bundle\'s interface + anon shapes.')
  lines.push('')
  if (emitTS) {
    lines.push(`import { type, type TypeDescriptor as __tu_TypeDescriptor } from '@tu-lang/std'`)
  } else {
    lines.push(`import { type } from '@tu-lang/std'`)
  }
  lines.push('')
  for (const desc of descriptors) {
    if (desc.origins.length > 0) {
      const origins = desc.origins
        .map((o) => `${o.filename}::${o.originalName}`)
        .join(', ')
      lines.push(`// ← merged from: ${origins}`)
    }
    const fieldsJs = desc.fields
      .map((f) => {
        const opt = f.optional ? ', optional: true' : ''
        return `{ name: ${JSON.stringify(f.name)}, type: ${rawTypeToDescriptorExpr(f.typeExpr)}${opt} }`
      })
      .join(', ')
    const ann = emitTS ? ': __tu_TypeDescriptor' : ''
    lines.push(
      `export const ${desc.canonicalName}${ann} = type.struct(${JSON.stringify(desc.origins[0]?.originalName ?? '__anon')}, [${fieldsJs}])`
    )
  }
  return lines.join('\n') + '\n'
}

/**
 * Map a raw type-expression string (as produced by the canonicalizer's
 * field-collection step) into the descriptor expression for the shared
 * module's emit. Mirrors `tuTypeToDescriptorExpr` in codegen.ts but
 * operates on the canonicalized representation (which has already
 * normalized whitespace + collapsed primitives).
 */
function rawTypeToDescriptorExpr(t: string): string {
  if (t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint' || t === 'symbol') {
    return `type.${capitalize(t)}`
  }
  if (t === 'null' || t === 'undefined' || t === 'void') return 'type.Null'
  if (t === 'any' || t === 'unknown') return 'type.Any'
  if (t === 'never') return 'type.Never'
  if (t === 'Function') return 'type.Function'
  if (t === 'RegExp') return 'type.RegExp'
  if (t.endsWith('[]')) {
    return `type.Array(${rawTypeToDescriptorExpr(t.slice(0, -2))})`
  }
  // `null | T` / `T | null` (canonicalizer normalizes whitespace; literal `|`)
  const orParts = t.split('|').map((s) => s.trim())
  if (orParts.length === 2) {
    if (orParts[0] === 'null' || orParts[0] === 'undefined') {
      return `type.Optional(${rawTypeToDescriptorExpr(orParts[1]!)})`
    }
    if (orParts[1] === 'null' || orParts[1] === 'undefined') {
      return `type.Optional(${rawTypeToDescriptorExpr(orParts[0]!)})`
    }
  }
  // Bare ident — assumed to be a user-declared interface or one of the
  // already-emitted canonical names.
  if (/^[A-Za-z_$][\w$]*$/.test(t)) return t
  return 'type.Object'
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
