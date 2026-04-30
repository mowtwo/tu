/**
 * Resolve a 0-based byte offset into 1-based line/column.
 */
export function lineColAt(source: string, offset: number): { line: number; col: number } {
  const clamped = Math.max(0, Math.min(offset, source.length))
  let line = 1
  let col = 1
  for (let i = 0; i < clamped; i++) {
    if (source.charAt(i) === '\n') {
      line++
      col = 1
    } else {
      col++
    }
  }
  return { line, col }
}

/**
 * Format a compile-time diagnostic with file:line:col + a code frame and
 * caret pointing at the offending column. Used by lexer, parser, and codegen
 * so every error a user sees follows the same shape:
 *
 *   parse error: expected RBrace, got Eof
 *     at hello.tu:3:18
 *
 *      2 |   div(class: "g") {
 *      3 |     h1 { "missing"
 *        |                  ^
 *      4 | }
 */
export function formatError(
  source: string,
  offset: number,
  message: string,
  filename?: string
): string {
  const { line, col } = lineColAt(source, offset)
  const lines = source.split('\n')
  const where = filename ? `${filename}:${line}:${col}` : `line ${line}, col ${col}`
  const gutterWidth = String(line + 1).length
  const pad = (n: number | '') => String(n).padStart(gutterWidth, ' ')

  const frame: string[] = []
  for (let i = Math.max(1, line - 1); i <= Math.min(lines.length, line + 1); i++) {
    frame.push(`  ${pad(i)} | ${lines[i - 1] ?? ''}`)
    if (i === line) {
      const caret = ' '.repeat(Math.max(0, col - 1)) + '^'
      frame.push(`  ${pad('')} | ${caret}`)
    }
  }
  return `${message}\n  at ${where}\n\n${frame.join('\n')}\n`
}
