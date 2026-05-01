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

  it('M3.13: surfaces CSS validation errors from inside a style block', () => {
    // `colour` is a misspelling — vscode-css-languageservice flags it as
    // an unknown property. The diagnostic should land on the source line
    // containing `.card { colour: red; }`, not on the let-decl header.
    const src = [
      'export let App = () => {',
      '  div(class: .card) { "hi" }',
      '  style { .card { colour: red; } }',
      '}',
    ].join('\n')
    const diags = checkTuSource(src, 'css.tu')
    const cssDiag = diags.find((d) => d.message.toLowerCase().includes('unknown'))
    expect(cssDiag).toBeDefined()
    // Line 2 (0-based) holds the offending property.
    expect(cssDiag!.line).toBe(2)
    // Length should cover `colour` (6 chars).
    expect(cssDiag!.length).toBe(6)
    // CSS diagnostics use code === -1 sentinel.
    expect(cssDiag!.code).toBe(-1)
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

  it('M6.8: DOM / global types are visible in .tu files (target ES2022 lib)', () => {
    // Lock in that tsserver sees `document`, `Math`, `JSON`, and Promise
    // without any explicit lib import on the .tu side. If a future change
    // to compilerOptions drops dom from the default lib, this test
    // catches it before users do.
    const diags = checkTuSource(
      `let host = document.getElementById("foo")
       let pi = Math.PI
       let parsed = JSON.parse("{}")
       let now = Date.now()`,
      'globals.tu'
    )
    expect(diags).toEqual([])
  })
})
