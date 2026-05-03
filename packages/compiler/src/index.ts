import { generateTSWithMap, generateWithMap, type CodegenOptions, type SourceMapV3, type TokenMapping } from './codegen.js'
import { parse } from './parser.js'
import { tokenize } from './lexer.js'

export const VERSION = '0.0.0'

export { Lexer, tokenize } from './lexer.js'
export { Parser, parse } from './parser.js'
export { classifyTopLevel, generate, generateTSWithMap, generateWithMap, getScopedClassMap, setMarkdownHighlight } from './codegen.js'
export { TokenKind, type Token } from './tokens.js'
export { formatError, lineColAt } from './diagnostics.js'
export type { CellKind, CodegenOptions, SourceMapV3, TokenMapping } from './codegen.js'
export type * from './ast.js'

// M8 Phase 6 — cross-module type canonicalizer (algorithm core).
export { canonicalizeShapes } from './canonicalize.js'
export type { CanonicalDescriptor, CanonicalizeResult } from './canonicalize.js'

// M8 Phase 6b/6c — bundle-mode compile orchestrator.
export { compileBundle } from './bundle.js'
export type { BundleInput, BundleOptions, BundleResult } from './bundle.js'

export interface CompileOptions extends CodegenOptions {
  /** Filename surfaced in compile errors and the source map's `sources` field. */
  filename?: string
}

export interface CompileResult {
  code: string
  map: SourceMapV3
  /** Per-token source-range mappings — consumed by the LSP for token-level
   *  diagnostic ranges. Not part of V3; built alongside the standard map. */
  tokenMappings: TokenMapping[]
}

/**
 * Compile a Tu source string to ESM JavaScript with an inline V3 source map.
 *
 * The output imports `h` from `@tu-lang/runtime` and exports each top-level `let`
 * binding as a `const`. A `//# sourceMappingURL=` footer carries a
 * base64-inlined V3 source map; the same map is also returned as `result.map`
 * for tooling (e.g. `@tu-lang/vite`) that prefers structured access.
 *
 * Compile errors include `filename:line:col` and a code-frame caret when
 * `filename` is supplied.
 */
export function compileWithMap(source: string, options: CompileOptions = {}): CompileResult {
  if (typeof source !== 'string') {
    throw new TypeError('compile() expects a string')
  }
  const filename = options.filename
  const tokens = tokenize(source, filename)
  const ast = parse(tokens, source, filename)
  return generateWithMap(ast, source, filename, options)
}

/**
 * Backwards-compatible string-only entrypoint. Returns the compiled JS with
 * the inline source-map footer; the caller can extract the map via the
 * standard `//# sourceMappingURL=` syntax if needed.
 */
export function compile(source: string, options: CompileOptions = {}): string {
  return compileWithMap(source, options).code
}

/**
 * Compile a Tu source string to TypeScript (with V3 source map). Same JS
 * shape as `compile()`, but lambda parameter type annotations from the Tu
 * source are preserved so tsserver / `tsc` / IDE tooling can infer the rest
 * of the program. Use this output for type-checking and `.d.ts` generation;
 * use `compile()` for runtime ESM.
 *
 * M2 V1: type erasure only — no synthesized component-prop interfaces or
 * style-class literal types. tsserver does the work via inference from the
 * existing JS shape (e.g. `new Signal.State(0)` infers `Signal.State<number>`).
 */
export function compileToTSWithMap(source: string, options: CompileOptions = {}): CompileResult {
  if (typeof source !== 'string') {
    throw new TypeError('compileToTS() expects a string')
  }
  const filename = options.filename
  const tokens = tokenize(source, filename)
  const ast = parse(tokens, source, filename)
  return generateTSWithMap(ast, source, filename, options)
}

/** String-only TS entrypoint; mirrors `compile()`. */
export function compileToTS(source: string, options: CompileOptions = {}): string {
  return compileToTSWithMap(source, options).code
}
