import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { formatDiagnostic, runCheck } from '../src/check.js'
import type { TuDiagnostic } from '@tu-lang/lsp'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'tu-cli-check-'))
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('runCheck — `tu check` integration', () => {
  it('exits 0 with an OK summary on a clean file', () => {
    const file = join(tmp, 'clean.tu')
    writeFileSync(file, 'export let count = 0\nexport let App = () => p { count }\n')
    let stdout = ''
    let stderr = ''
    const result = runCheck([file], {
      cwd: tmp,
      writeOut: (s) => (stdout += s),
      writeErr: (s) => (stderr += s),
    })
    expect(result.exitCode).toBe(0)
    expect(result.errorCount).toBe(0)
    expect(result.filesChecked).toBe(1)
    expect(stdout).toMatch(/1 file OK/)
    expect(stderr).toBe('')
  })

  it('exits 1 with a formatted diagnostic on a typed-param mismatch', () => {
    const file = join(tmp, 'bad.tu')
    writeFileSync(
      file,
      'export let G = (name: string) => p { name }\nexport let App = () => G(42)\n'
    )
    let stdout = ''
    let stderr = ''
    const result = runCheck([file], {
      cwd: tmp,
      writeOut: (s) => (stdout += s),
      writeErr: (s) => (stderr += s),
    })
    expect(result.exitCode).toBe(1)
    expect(result.errorCount).toBeGreaterThan(0)
    // Diagnostic header includes file:line:col + severity + a TS code tag.
    expect(stdout).toMatch(/bad\.tu:2:\d+: ERROR \[TS\d+\]/)
    // Source line and caret marker should appear in the code frame.
    expect(stdout).toContain('G(42)')
    expect(stdout).toMatch(/\^\^/)
  })

  it('exits 1 with a clear error when no files are passed', () => {
    let stderr = ''
    const result = runCheck([], {
      cwd: tmp,
      writeOut: () => {},
      writeErr: (s) => (stderr += s),
    })
    expect(result.exitCode).toBe(1)
    expect(stderr).toMatch(/no \.tu files given/)
  })

  it('exits 1 when a non-.tu file is passed', () => {
    const file = join(tmp, 'foo.txt')
    writeFileSync(file, 'not tu')
    let stderr = ''
    const result = runCheck([file], {
      cwd: tmp,
      writeOut: () => {},
      writeErr: (s) => (stderr += s),
    })
    expect(result.exitCode).toBe(1)
    expect(stderr).toMatch(/not a \.tu file/)
  })

  it('exits 1 when a file does not exist', () => {
    let stderr = ''
    const result = runCheck([join(tmp, 'missing.tu')], {
      cwd: tmp,
      writeOut: () => {},
      writeErr: (s) => (stderr += s),
    })
    expect(result.exitCode).toBe(1)
    expect(stderr).toMatch(/no such file/)
  })
})

describe('formatDiagnostic — single-diagnostic rendering', () => {
  it('produces a 3-line code frame with a caret span', () => {
    const source = ['line one', 'export let bad = 42', 'line three'].join('\n')
    const d: TuDiagnostic = {
      line: 1,
      col: 11,
      length: 3,
      severity: 'error',
      code: 2345,
      message: 'demo',
    }
    const out = formatDiagnostic(d, source, 'demo.tu')
    expect(out).toContain('demo.tu:2:12: ERROR [TS2345] demo')
    expect(out).toContain('export let bad = 42')
    // Caret is `^^^` (length 3) at col 11 — preceded by 11 spaces in the
    // gutter-stripped portion.
    const caretLine = out.split('\n').find((l) => l.includes('^^^'))
    expect(caretLine).toBeDefined()
  })
})
