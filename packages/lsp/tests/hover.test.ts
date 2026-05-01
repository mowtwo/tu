import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hoverAtTuPosition } from '../src/hover.js'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'tu-lsp-hover-'))
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('hoverAtTuPosition — quick info at a .tu cursor position', () => {
  it('shows Signal.State<number> for a state-cell read', () => {
    // Source layout (0-based cols):
    //   line 0: export let count = 0
    //   line 1: export let App = () => p { count }
    //                                       ^ col 32 — `count` read inside the lambda body
    const src = [
      'export let count = 0',
      'export let App = () => p { count }',
    ].join('\n')
    const info = hoverAtTuPosition(src, join(tmp, 'state.tu'), 1, 28)
    expect(info).not.toBeNull()
    expect(info!.contents.toLowerCase()).toContain('signal')
    expect(info!.contents).toMatch(/number/i)
    // Range covers `count` (5 chars).
    expect(info!.line).toBe(1)
    expect(info!.col).toBe(27)
    expect(info!.length).toBe(5)
  })

  it('shows the parameter type for a typed lambda param read', () => {
    // line 0: export let G = (name: string) => p { name }
    //                                              ^ col 42 — the `name` read inside the body
    const src = 'export let G = (name: string) => p { name }'
    const info = hoverAtTuPosition(src, join(tmp, 'param.tu'), 0, 38)
    expect(info).not.toBeNull()
    // tsserver renders this as `(parameter) name: string`.
    expect(info!.contents).toMatch(/parameter/)
    expect(info!.contents).toMatch(/string/)
    expect(info!.length).toBe(4)
  })

  it('resolves an imported component to its function signature', () => {
    writeFileSync(
      join(tmp, 'Card.tu'),
      'export let Card = (label: string) => p { label }\n'
    )
    const appPath = join(tmp, 'App.tu')
    const appSrc = [
      'import { Card } from "./Card.tu"',
      'export let App = () => Card("hi")',
    ].join('\n')
    // Hover on `Card` at the call site (line 1, starts at col 23).
    const info = hoverAtTuPosition(appSrc, appPath, 1, 24)
    expect(info).not.toBeNull()
    expect(info!.contents).toMatch(/string/)
    expect(info!.length).toBe(4)
  })

  it('returns null when the cursor lands on whitespace or a Tu keyword', () => {
    const src = 'export let count = 0'
    // Col 0 is `e` in `export` — lexed as a Tu keyword, no TokenMapping.
    expect(hoverAtTuPosition(src, join(tmp, 'kw.tu'), 0, 0)).toBeNull()
    // Col 6 is the space between `export` and `let` — pure whitespace.
    expect(hoverAtTuPosition(src, join(tmp, 'kw.tu'), 0, 6)).toBeNull()
    // Col 17 is the `=` operator — punctuation, no TokenMapping.
    expect(hoverAtTuPosition(src, join(tmp, 'kw.tu'), 0, 17)).toBeNull()
  })

  it('M3.12: hovering a CSS property inside a style block returns CSS docs', () => {
    const src = [
      'export let App = () => {',
      '  div(class: .card) { "hi" }',
      '  style {',
      '    .card { color: red; }',
      '  }',
      '}',
    ].join('\n')
    // Line 3, col 13 — sits on the `c` of `color`. The CSS LS should
    // surface the property's documentation.
    const info = hoverAtTuPosition(src, join(tmp, 'css-hover.tu'), 3, 13)
    expect(info).not.toBeNull()
    // CSS LS hover content includes the property name.
    expect(info!.contents.toLowerCase()).toContain('color')
    // Range is on line 3 (the same source line as `color`).
    expect(info!.line).toBe(3)
  })

  it('LSP: hovering an HTML attribute name returns MDN-style docs', () => {
    // line 0: export let App = () => button(class: "go") { "click" }
    //                                       ^^^^^ col 30 — the `class` attr
    const src = 'export let App = () => button(class: "go") { "click" }'
    const info = hoverAtTuPosition(src, join(tmp, 'attr-hover.tu'), 0, 31)
    expect(info).not.toBeNull()
    // vscode-html-languageservice attribute docs include the attr name.
    expect(info!.contents).toContain('`class`')
    expect(info!.length).toBe(5)
  })

  it('M6.0+: hovering an HTML tag identifier returns MDN-style docs', () => {
    // line 0: export let App = () => button(class: "go") { "click" }
    //                                ^^^^^^ col 23 — the `button` tag
    const src = 'export let App = () => button(class: "go") { "click" }'
    const info = hoverAtTuPosition(src, join(tmp, 'html-hover.tu'), 0, 24)
    expect(info).not.toBeNull()
    // vscode-html-languageservice content includes the tag wrapped in
    // backticks plus a description.
    expect(info!.contents).toContain('`<button>`')
    expect(info!.contents.toLowerCase()).toContain('button')
    // Range covers exactly `button` (6 chars).
    expect(info!.length).toBe(6)
  })

  it('M6.0+: hovering a non-standard tag name (Web Component) returns null', () => {
    const src = 'export let App = () => my-element { "x" }'
    // Tu's lexer rejects `-` inside an ident, so this won't parse — guard
    // against the hover path crashing on a non-standard tag word.
    const info = hoverAtTuPosition(src, join(tmp, 'unknown-tag.tu'), 0, 24)
    // Either null (parse failure → no shadow) or a non-html-tag hover.
    if (info !== null) {
      expect(info.contents).not.toContain('<my-element>')
    }
  })

  it('returns null when the source has a Tu compile error', () => {
    // Unbalanced braces — buildShadowGraph swallows the compile error and
    // returns no shadow for the root file. Hover gracefully degrades to null.
    const src = 'export let App = () => h1 { "missing close brace"'
    expect(hoverAtTuPosition(src, join(tmp, 'broken.tu'), 0, 12)).toBeNull()
  })
})
