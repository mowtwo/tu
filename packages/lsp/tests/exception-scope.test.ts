import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkTuSource } from '../src/diagnostics.js'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'tu-lsp-exception-'))
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('Exception scope checker (M9 Phase 4)', () => {
  it('flags an undeclared throw against a declared throws clause', () => {
    const src = [
      'Exception NotFoundError { resource: string }',
      'Exception ValidationError { field: string }',
      'let lookup = (id: string): string ? NotFoundError => {',
      '  throw ValidationError("bad input", { field: "id" })',
      '}',
    ].join('\n')
    const diags = checkTuSource(src, join(tmp, 'a.tu'))
    const exDiags = diags.filter((d) => /declared throws clause/i.test(d.message))
    expect(exDiags.length).toBe(1)
    expect(exDiags[0]!.severity).toBe('error')
    expect(exDiags[0]!.message).toContain('lookup')
    expect(exDiags[0]!.message).toContain('ValidationError')
    // The diagnostic message points users to widening the clause AND
    // wrapping in try/catch as alternatives.
    expect(exDiags[0]!.message).toMatch(/try.*catch/)
  })

  it('passes when the throw is in the declared clause', () => {
    const src = [
      'Exception NotFoundError { resource: string }',
      'let lookup = (id: string): string ? NotFoundError => {',
      '  throw NotFoundError("missing", { resource: "user" })',
      '}',
    ].join('\n')
    const diags = checkTuSource(src, join(tmp, 'a.tu'))
    const exDiags = diags.filter((d) => /declared throws clause/i.test(d.message))
    expect(exDiags).toHaveLength(0)
  })

  it('passes when the function declares a union and throws one member', () => {
    const src = [
      'Exception AError { code: number }',
      'Exception BError { code: number }',
      'let f = (): string ? AError | BError => {',
      '  throw BError("x", { code: 1 })',
      '}',
    ].join('\n')
    const diags = checkTuSource(src, join(tmp, 'a.tu'))
    const exDiags = diags.filter((d) => /declared throws clause/i.test(d.message))
    expect(exDiags).toHaveLength(0)
  })

  it('lenient: undeclared throws clause is NOT flagged in v1', () => {
    // Function has NO throws clause but DOES throw — v1 doesn't
    // flag (Phase 4b will warn / suggest a clause).
    const src = [
      'Exception E { code: number }',
      'let f = (): string => {',
      '  throw E("x", { code: 1 })',
      '}',
    ].join('\n')
    const diags = checkTuSource(src, join(tmp, 'a.tu'))
    const exDiags = diags.filter((d) => /declared throws clause/i.test(d.message))
    expect(exDiags).toHaveLength(0)
  })

  it('try/catch wrapping suppresses the diagnostic for caught throws', () => {
    const src = [
      'Exception E { code: number }',
      'let f = (): string ? E => {',
      '  try { throw E("a", { code: 1 }) }',
      '  catch (e: E) { "ok" }',
      '}',
    ].join('\n')
    const diags = checkTuSource(src, join(tmp, 'a.tu'))
    // No exception-scope diagnostic — try/catch optimistically catches.
    const exDiags = diags.filter((d) => /declared throws clause/i.test(d.message))
    expect(exDiags).toHaveLength(0)
  })

  it('throws of generic Error / unknown idents are not flagged (only known Exceptions)', () => {
    const src = [
      'Exception E { code: number }',
      'let f = (): string ? E => {',
      '  throw new Error("plain")',
      '}',
    ].join('\n')
    const diags = checkTuSource(src, join(tmp, 'a.tu'))
    const exDiags = diags.filter((d) => /declared throws clause/i.test(d.message))
    expect(exDiags).toHaveLength(0)
  })

  it('inner lambda throws do NOT propagate to the outer function', () => {
    // The inner lambda's throws are scoped to itself; the outer fn
    // shouldn't be required to declare them.
    const src = [
      'Exception E { code: number }',
      'let f = (): string => {',
      '  let inner = (): string ? E => { throw E("x", { code: 1 }) }',
      '  inner()',
      '}',
    ].join('\n')
    const diags = checkTuSource(src, join(tmp, 'a.tu'))
    const exDiags = diags.filter((d) => /declared throws clause/i.test(d.message))
    expect(exDiags).toHaveLength(0)
  })
})
