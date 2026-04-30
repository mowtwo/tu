import { generateWithMap, type SourceMapV3 } from './codegen.js'
import { parse } from './parser.js'
import { tokenize } from './lexer.js'

export const VERSION = '0.0.0'

export { Lexer, tokenize } from './lexer.js'
export { Parser, parse } from './parser.js'
export { generate, generateWithMap } from './codegen.js'
export { TokenKind, type Token } from './tokens.js'
export { formatError, lineColAt } from './diagnostics.js'
export type { SourceMapV3 } from './codegen.js'
export type * from './ast.js'

export interface CompileOptions {
  /** Filename surfaced in compile errors and the source map's `sources` field. */
  filename?: string
}

export interface CompileResult {
  code: string
  map: SourceMapV3
}

/**
 * Compile a Tu source string to ESM JavaScript with an inline V3 source map.
 *
 * The output imports `h` from `@tu/runtime` and exports each top-level `let`
 * binding as a `const`. A `//# sourceMappingURL=` footer carries a
 * base64-inlined V3 source map; the same map is also returned as `result.map`
 * for tooling (e.g. `@tu/vite`) that prefers structured access.
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
  return generateWithMap(ast, source, filename)
}

/**
 * Backwards-compatible string-only entrypoint. Returns the compiled JS with
 * the inline source-map footer; the caller can extract the map via the
 * standard `//# sourceMappingURL=` syntax if needed.
 */
export function compile(source: string, options: CompileOptions = {}): string {
  return compileWithMap(source, options).code
}
