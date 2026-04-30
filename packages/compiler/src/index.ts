import { generate } from './codegen.js'
import { parse } from './parser.js'
import { tokenize } from './lexer.js'

export const VERSION = '0.0.0'

export { Lexer, tokenize } from './lexer.js'
export { Parser, parse } from './parser.js'
export { generate } from './codegen.js'
export { TokenKind, type Token } from './tokens.js'
export type * from './ast.js'

/**
 * Compile a Tu source string to ESM JavaScript.
 *
 * The output imports `h` from `@tu/runtime` and exports each top-level
 * `let` binding as a `const`.
 */
export function compile(source: string): string {
  if (typeof source !== 'string') {
    throw new TypeError('compile() expects a string')
  }
  const tokens = tokenize(source)
  const ast = parse(tokens)
  return generate(ast)
}
