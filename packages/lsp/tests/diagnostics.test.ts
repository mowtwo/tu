import { describe, expect, it } from 'vitest'
import { checkTuSource } from '../src/diagnostics.js'

describe('checkTuSource — diagnostic round-trip', () => {
  it('clean source produces zero diagnostics', () => {
    const diags = checkTuSource(
      `export let count = 0
       export let App = () => p { count }`,
      'clean.tu'
    )
    expect(diags).toEqual([])
  })

  it('flags a type error at the offending source line', () => {
    // count.set("string") on a Signal.State<number> is a TS error.
    const src = [
      'export let count = 0',
      'export let setBad = () => count = "not a number"',
    ].join('\n')
    const diags = checkTuSource(src, 'bad.tu')
    expect(diags.length).toBeGreaterThan(0)
    const first = diags[0]!
    // The error originates from the `setBad` lambda body — line 1 (0-based).
    expect(first.line).toBe(1)
    expect(first.severity).toBe('error')
    expect(first.message.toLowerCase()).toMatch(/string|assignable|number/)
  })

  it('captures Tu compile errors as a single diagnostic at the top of the file', () => {
    const src = 'export let App = () => h1 { "missing closing brace"'
    const diags = checkTuSource(src, 'syntax.tu')
    expect(diags.length).toBe(1)
    expect(diags[0]?.severity).toBe('error')
    // Compile errors come pre-formatted from M1.9 — they include `:line:col`.
    expect(diags[0]?.message).toMatch(/:\d+:\d+/)
  })

  it('typed lambda params are checked', () => {
    const src = [
      'export let G = (name: string) => p { name }',
      // Calling G with a number — TS should complain.
      'export let App = () => G(42)',
    ].join('\n')
    const diags = checkTuSource(src, 'param.tu')
    expect(diags.length).toBeGreaterThan(0)
    expect(diags.some((d) => d.message.toLowerCase().includes('number'))).toBe(true)
  })

  it('squiggles only the offending arg token, not the whole let header', () => {
    // `42` is the bad arg; the diagnostic should land on the literal `42`
    // (length 2), not on the `export let App` header.
    const src = [
      'export let G = (name: string) => p { name }',
      'export let App = () => G(42)',
    ].join('\n')
    const diags = checkTuSource(src, 'token-range.tu')
    const argDiag = diags.find((d) => d.message.toLowerCase().includes('number'))
    expect(argDiag).toBeDefined()
    expect(argDiag!.line).toBe(1)
    // Source: `export let App = () => G(42)`
    //                                  ^^ — the `42` starts at col 25.
    expect(argDiag!.col).toBe(25)
    expect(argDiag!.length).toBe(2)
  })

  it('squiggles the offending RHS literal in a state-cell assignment', () => {
    // `count.set("not a number")` — TS reports on `"not a number"`. The
    // string literal in the source spans `"not a number"` (15 chars).
    const src = [
      'export let count = 0',
      'export let setBad = () => count = "not a number"',
    ].join('\n')
    const diags = checkTuSource(src, 'assign.tu')
    expect(diags.length).toBeGreaterThan(0)
    const first = diags[0]!
    expect(first.line).toBe(1)
    // The string literal `"not a number"` starts at col 34 in the source.
    expect(first.col).toBe(34)
    // Length covers `"not a number"` — 12 chars + 2 quotes = 14.
    expect(first.length).toBe(14)
  })
})
