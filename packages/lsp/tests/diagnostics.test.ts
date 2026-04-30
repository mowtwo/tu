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
})
