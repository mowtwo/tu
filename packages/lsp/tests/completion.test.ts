import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { completionsAtTuPosition } from '../src/completion.js'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'tu-lsp-completion-'))
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('completionsAtTuPosition — completion at a .tu cursor position', () => {
  it('proposes a previously-declared name when the cursor is mid-identifier', () => {
    // Source: line 0 declares `count`; line 1 starts an exported lambda whose
    // body refers to a partial `co`. tsserver should still surface `count`
    // among the completions because the partial expression is a valid Ident.
    const src = ['export let count = 0', 'export let App = () => p { co }'].join('\n')
    // Cursor at the end of `co` on line 1 — `co` spans cols 27..28; the
    // cursor sits at col 29 (just past `o`, before the trailing space).
    const items = completionsAtTuPosition(src, join(tmp, 'mid.tu'), 1, 29)
    const labels = items.map((i) => i.label)
    expect(labels).toContain('count')
  })

  it('completes typed-param names inside the lambda body', () => {
    const src = 'export let G = (label: string) => p { lab }'
    // `lab` ends at col 41 (positions: `p { lab }` → l at 38, a at 39, b at 40, end at 41)
    const items = completionsAtTuPosition(src, join(tmp, 'param.tu'), 0, 41)
    const labels = items.map((i) => i.label)
    expect(labels).toContain('label')
    // The matching item should be marked as a parameter.
    const labelItem = items.find((i) => i.label === 'label')
    expect(labelItem?.kind).toBe('parameter')
  })

  it('cross-`.tu` import: completions surface names imported from another file', () => {
    writeFileSync(
      join(tmp, 'Card.tu'),
      'export let Card = (label: string) => p { label }\n'
    )
    const appPath = join(tmp, 'App.tu')
    const appSrc = [
      'import { Card } from "./Card.tu"',
      'export let App = () => Ca',
    ].join('\n')
    // `Ca` is at the end of line 1; cursor at col 25 (line 1, after `Ca`).
    const items = completionsAtTuPosition(appSrc, appPath, 1, 25)
    const labels = items.map((i) => i.label)
    expect(labels).toContain('Card')
  })

  it('returns [] when the source has a Tu compile error', () => {
    const src = 'export let App = () => h1 { "unclosed'
    expect(completionsAtTuPosition(src, join(tmp, 'broken.tu'), 0, 10)).toEqual([])
  })

  it('returns [] when the cursor lands outside any token AND outside expression context', () => {
    const src = 'export let count = 0'
    // Col 6 — whitespace between `export` and `let`. The char immediately
    // before is `t` (an ident char), so the heuristic doesn't classify
    // this as expression-head; tsserver also returns no items.
    expect(completionsAtTuPosition(src, join(tmp, 'ws.tu'), 0, 6)).toEqual([])
  })

  it('M3.10: surfaces HTML tag names at expression head', () => {
    // Cursor right after `=> ` — the char immediately before is a space,
    // which the heuristic treats as expression-head. HTML tags should be
    // augmented in.
    const src = 'export let App = () => '
    const items = completionsAtTuPosition(src, join(tmp, 'tags.tu'), 0, 23)
    const labels = items.map((i) => i.label)
    expect(labels).toContain('div')
    expect(labels).toContain('p')
    expect(labels).toContain('button')
    expect(labels).toContain('h1')
    // And the existing detail string surfaces the tag-call mapping.
    const div = items.find((i) => i.label === 'div')!
    expect(div.detail).toMatch(/h\("div"/)
  })

  it('M3.10: surfaces declared classes after `.` inside a scoped component', () => {
    const src = [
      'export let App = () => {',
      '  div(class: ) { "hi" }',
      '  style { .card { padding: 1rem } .shadow { box-shadow: 0 0 4px } }',
      '}',
    ].join('\n')
    // Place cursor right after the `:` and a `.` we'll insert virtually.
    // Actually use a real source with the dot already in place:
    const src2 = [
      'export let App = () => {',
      '  div(class: .) { "hi" }',
      '  style { .card { padding: 1rem } .shadow { box-shadow: 0 0 4px } }',
      '}',
    ].join('\n')
    // Cursor on line 1, col 14 — right after the `.` in `class: .)`.
    const items = completionsAtTuPosition(src2, join(tmp, 'classes.tu'), 1, 14)
    const labels = items.map((i) => i.label)
    expect(labels).toContain('card')
    expect(labels).toContain('shadow')
  })

  it('M3.11: CSS property completion inside a style block', () => {
    // Cursor is on the line that has `.card { col` — right after `col`. The
    // CSS LS should suggest `color`, `column-count`, etc.
    const src = [
      'export let App = () => {',
      '  div(class: .card) { "hi" }',
      '  style {',
      '    .card { col }',
      '  }',
      '}',
    ].join('\n')
    // Line 3, col 14 — right after `col` (and before the trailing space + }).
    const items = completionsAtTuPosition(src, join(tmp, 'css.tu'), 3, 14)
    const labels = items.map((i) => i.label)
    expect(labels).toContain('color')
    // CSS completion should NOT mix in our HTML tag list.
    expect(labels).not.toContain('div')
  })

  it('M3.11: cursor outside any style block returns to the Tu/TS path', () => {
    const src = [
      'export let App = () => {',
      '  div(class: .card) { "hi" }',
      '  style {',
      '    .card { color: red; }',
      '  }',
      '}',
    ].join('\n')
    // Line 0, col 23 — after `=> ` in the lambda. Tu expression-head path.
    const items = completionsAtTuPosition(src, join(tmp, 'no-css.tu'), 0, 23)
    const labels = items.map((i) => i.label)
    expect(labels).toContain('div')
    // The CSS LS should NOT have run — `color` is not a Tu ident so no
    // CSS prop should appear.
    expect(labels).not.toContain('color')
  })

  it('M5.4: surfaces TS built-in types in a let-decl annotation position', () => {
    const src = 'export let count: '
    const items = completionsAtTuPosition(src, join(tmp, 'type-let.tu'), 0, 18)
    const labels = items.map((i) => i.label)
    expect(labels).toContain('string')
    expect(labels).toContain('number')
    expect(labels).toContain('boolean')
    expect(labels).toContain('VNode')
    expect(labels).toContain('Child')
  })

  it('M5.4/M9: surfaces user-defined named types in a type position', () => {
    const src = [
      'interface Person { name: string }',
      'enum Tone { Neutral, Accent = "accent" }',
      'Exception NotFound { resource: string }',
      'export let alice: ',
    ].join('\n')
    const items = completionsAtTuPosition(src, join(tmp, 'type-user.tu'), 3, 18)
    const labels = items.map((i) => i.label)
    expect(labels).toContain('Person')
    expect(labels).toContain('Tone')
    expect(labels).toContain('NotFound')
    const person = items.find((i) => i.label === 'Person')!
    expect(person.detail).toMatch(/named type/)
  })

  it('M5.4: surfaces types in a lambda param annotation position', () => {
    // `let f = (x: |)` — cursor at the `|` mark inside the param paren.
    const src = 'export let f = (x: ) => x'
    const items = completionsAtTuPosition(src, join(tmp, 'type-param.tu'), 0, 19)
    const labels = items.map((i) => i.label)
    expect(labels).toContain('string')
    expect(labels).toContain('number')
  })

  it('M3.10: HTML tags do not duplicate user idents already returned by tsserver', () => {
    // User declared a `div` of their own (rare but legal). tsserver
    // returns it; our augmentation must not add a second `div` entry.
    const src = ['export let div = 1', 'export let App = () => '].join('\n')
    const items = completionsAtTuPosition(src, join(tmp, 'dup.tu'), 1, 23)
    const divs = items.filter((i) => i.label === 'div')
    expect(divs).toHaveLength(1)
  })
})
