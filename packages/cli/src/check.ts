import { checkTuFile, type TuDiagnostic } from '@tu/lsp'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

export interface CheckOptions {
  /** Working directory used to resolve relative file arguments. */
  cwd: string
  /** Override the writers — useful for tests. */
  writeOut?: (chunk: string) => void
  writeErr?: (chunk: string) => void
}

export interface CheckResult {
  /** Number of files inspected (skipped files don't count). */
  filesChecked: number
  /** Total error-severity diagnostics across all files. */
  errorCount: number
  /** Total warning-severity diagnostics. */
  warningCount: number
  /** Recommended process exit code: 0 on clean, 1 if any error or no inputs. */
  exitCode: number
}

/**
 * `tu check <file…>` — type-check one or more `.tu` files and pretty-print
 * the diagnostics. Returns a `CheckResult` so callers (the bin script and
 * tests) can decide how to surface the outcome.
 *
 * Each diagnostic is rendered as `<file>:<line>:<col>: <severity> [<code>]
 * <message>` followed by a 3-line code frame with a caret marker.
 */
export function runCheck(files: string[], options: CheckOptions): CheckResult {
  const writeOut = options.writeOut ?? ((s: string) => process.stdout.write(s))
  const writeErr = options.writeErr ?? ((s: string) => process.stderr.write(s))
  if (files.length === 0) {
    writeErr(`tu check: no .tu files given\n`)
    return { filesChecked: 0, errorCount: 0, warningCount: 0, exitCode: 1 }
  }
  let errorCount = 0
  let warningCount = 0
  let filesChecked = 0
  for (const arg of files) {
    const abs = isAbsolute(arg) ? arg : resolve(options.cwd, arg)
    if (!existsSync(abs)) {
      writeErr(`tu check: ${arg}: no such file\n`)
      errorCount++
      continue
    }
    const stat = statSync(abs)
    if (stat.isDirectory()) {
      writeErr(`tu check: ${arg}: is a directory (pass a .tu file)\n`)
      errorCount++
      continue
    }
    if (!arg.endsWith('.tu')) {
      writeErr(`tu check: ${arg}: not a .tu file\n`)
      errorCount++
      continue
    }
    filesChecked++
    const diags = checkTuFile(abs)
    if (diags.length === 0) continue
    const source = readFileSync(abs, 'utf-8')
    const display = relative(options.cwd, abs) || abs
    for (const d of diags) {
      if (d.severity === 'error') errorCount++
      if (d.severity === 'warning') warningCount++
      writeOut(formatDiagnostic(d, source, display) + '\n')
    }
  }
  if (filesChecked === 0) {
    return { filesChecked: 0, errorCount, warningCount, exitCode: 1 }
  }
  if (errorCount === 0) {
    writeOut(
      `tu check: ${filesChecked} file${filesChecked === 1 ? '' : 's'} OK` +
        (warningCount > 0 ? ` (${warningCount} warning${warningCount === 1 ? '' : 's'})` : '') +
        '\n'
    )
  }
  return {
    filesChecked,
    errorCount,
    warningCount,
    exitCode: errorCount > 0 ? 1 : 0,
  }
}

/**
 * Render a single TuDiagnostic into a multi-line, terminal-friendly string.
 * Format mirrors the existing M1.9 compile-error formatter:
 *
 *   path/to/foo.tu:5:23: error [TS2345] Argument of type 'number'…
 *
 *      4 | export let App = () => p { count }
 *      5 |   bar = 42
 *        |         ^^
 *      6 |   baz
 */
export function formatDiagnostic(d: TuDiagnostic, source: string, file: string): string {
  const sev = d.severity.toUpperCase()
  const codeTag = d.code > 0 ? ` [TS${d.code}]` : ''
  const head = `${file}:${d.line + 1}:${d.col + 1}: ${sev}${codeTag} ${d.message}`
  const lines = source.split('\n')
  const gutterWidth = String(Math.min(lines.length, d.line + 2) + 1).length
  const pad = (n: number | '') => String(n).padStart(gutterWidth, ' ')
  const frame: string[] = []
  for (let i = Math.max(0, d.line - 1); i <= Math.min(lines.length - 1, d.line + 1); i++) {
    frame.push(`  ${pad(i + 1)} | ${lines[i] ?? ''}`)
    if (i === d.line) {
      const caret = ' '.repeat(d.col) + '^'.repeat(Math.max(1, d.length))
      frame.push(`  ${pad('')} | ${caret}`)
    }
  }
  return `${head}\n\n${frame.join('\n')}`
}
