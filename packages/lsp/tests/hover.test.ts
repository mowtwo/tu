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

  it('LSP walkers reach into every expr kind — hover works on tags nested in newer constructs', () => {
    // Each line wraps the same `button { "x" }` tag-call inside one of
    // the newer expression kinds (try/return/throw, ternary, nested
    // lambda + IIFE, await + import, member assign, template literal,
    // local let). Cursor lands on the `button` ident; we expect the
    // HTML hover to fire (which means the AST walker reached it). The
    // bug pre-fix: walkers stopped at TryExpr / TernaryExpr / etc.,
    // so hover would silently no-op on these files.
    const lines = [
      // 0: try
      'export let A = () => try { button { "a" } } catch (e) { p { "e" } }',
      // 1: if-else expression (M9 banned ternary; if/else is the replacement)
      'export let B = (c: boolean) => if (c) { button { "y" } } else { p { "n" } }',
      // 2: throw inside if
      'export let C = (x: number) => { if (x < 0) { throw button { "neg" } }; p { "ok" } }',
      // 3: template literal in an attr
      'export let D = (n: string) => button(class: `b-${n}`) { "x" }',
      // 4: local let then tag
      'export let E = () => { let label = "click"; button { label } }',
    ]
    const src = lines.join('\n')
    // For each line above, point col at the START of `button`. The
    // tag's tagStart is right after the construct's prefix.
    const cases = [
      { line: 0, col: src.split('\n')[0]!.indexOf('button') },
      { line: 1, col: src.split('\n')[1]!.indexOf('button') },
      { line: 2, col: src.split('\n')[2]!.indexOf('button') },
      { line: 3, col: src.split('\n')[3]!.indexOf('button') },
      { line: 4, col: src.split('\n')[4]!.indexOf('button') },
    ]
    for (const c of cases) {
      const info = hoverAtTuPosition(src, join(tmp, 'walker-coverage.tu'), c.line, c.col)
      expect(info, `hover failed at line ${c.line}, col ${c.col}`).not.toBeNull()
      expect(info!.contents).toContain('`<button>`')
    }
  })

  // ─── M9 LSP — interface hover expansion ────────────────────────────

  it('M9: hovering a binding typed as an interface expands the field list', () => {
    const src = [
      'interface User { id: number; name: string; email: string | null }',
      'export let alice: User = { id: 1, name: "Alice", email: null }',
    ].join('\n')
    // Cursor on the `alice` ident (line 1, col 12).
    const info = hoverAtTuPosition(src, join(tmp, 'a.tu'), 1, 12)
    expect(info).not.toBeNull()
    // Documentation contains the expanded interface body.
    expect(info!.documentation).toBeDefined()
    expect(info!.documentation!).toContain('User')
    expect(info!.documentation!).toContain('id: number')
    expect(info!.documentation!).toContain('name: string')
    expect(info!.documentation!).toContain('email: string | null')
  })

  it('M9: hovering an unannotated object cell prefers the nearest matching interface name', () => {
    const src = [
      'interface Point { x: number; y: number }',
      'export let origin = { x: 0, y: 0 }',
    ].join('\n')
    const info = hoverAtTuPosition(src, join(tmp, 'a.tu'), 1, 12)
    expect(info).not.toBeNull()
    expect(info!.contents).toContain('Signal.State<Point>')
    expect(info!.contents).not.toContain('{ x: number; y: number; }')
    expect(info!.documentation).toContain('Point')
    expect(info!.documentation).toContain('x: number')
    expect(info!.documentation).toContain('y: number')
  })

  it('M9: object-shape hover matching widens literal property types', () => {
    const src = [
      'interface Tagged { kind: string; count: number; enabled: boolean }',
      'export let tagged = { kind: "point", count: 1, enabled: true }',
    ].join('\n')
    const info = hoverAtTuPosition(src, join(tmp, 'a.tu'), 1, 12)
    expect(info).not.toBeNull()
    expect(info!.contents).toContain('Signal.State<Tagged>')
  })

  it('M8/M9: interface hover reports canonical same-shape merges', () => {
    writeFileSync(join(tmp, 'person.tu'), 'export interface Person { id: number; name: string }\n')
    const src = [
      'import { Person } from "./person.tu"',
      'interface User { id: number; name: string }',
      'export let alice: User = { id: 1, name: "Alice" }',
    ].join('\n')
    const info = hoverAtTuPosition(src, join(tmp, 'a.tu'), 2, 12)
    expect(info).not.toBeNull()
    expect(info!.documentation).toContain('User')
    expect(info!.documentation).toContain('Merged with: Person (from person.tu)')
  })

  it('M9: hovering a typed lambda param expands the param interface', () => {
    const src = [
      'interface Card { title: string; count: number }',
      'export let render = (c: Card) => p { c.title }',
    ].join('\n')
    // Cursor on the `c` param read inside the lambda body
    // (line 1 col 37 — the `c` in `c.title`).
    const info = hoverAtTuPosition(src, join(tmp, 'a.tu'), 1, 37)
    expect(info).not.toBeNull()
    expect(info!.documentation).toBeDefined()
    expect(info!.documentation!).toContain('Card')
    expect(info!.documentation!).toContain('title: string')
    expect(info!.documentation!).toContain('count: number')
  })

  it('M6.12: hovering an interface name in a lambda param annotation expands it', () => {
    const lines = [
      'interface Card { title: string; count: number }',
      'export let render = (c: Card) => p { c.title }',
    ]
    const src = lines.join('\n')
    const col = lines[1]!.indexOf('Card')
    const info = hoverAtTuPosition(src, join(tmp, 'a.tu'), 1, col)
    expect(info).not.toBeNull()
    expect(info!.documentation).toContain('Card')
    expect(info!.documentation).toContain('title: string')
    expect(info!.documentation).toContain('count: number')
    expect(info!.line).toBe(1)
    expect(info!.col).toBe(col)
    expect(info!.length).toBe(4)
  })

  it('M9: non-interface type hover (primitive number) does NOT inject expansion', () => {
    const src = ['export let count: number = 0'].join('\n')
    const info = hoverAtTuPosition(src, join(tmp, 'a.tu'), 0, 12)
    expect(info).not.toBeNull()
    // No interface block in documentation.
    expect(info!.documentation ?? '').not.toContain('interface ')
  })
})
