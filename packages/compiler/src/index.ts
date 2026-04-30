export const VERSION = '0.0.0'

/**
 * Compile a Tu source string to JavaScript.
 * Real implementation lands in M1 (lexer → parser → AST → codegen).
 */
export function compile(source: string): string {
  if (typeof source !== 'string') {
    throw new TypeError('compile() expects a string')
  }
  return `/* @tu/compiler stub: ${source.length} bytes in */\nexport {}\n`
}
