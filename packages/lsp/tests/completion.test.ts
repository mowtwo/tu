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

  it('returns [] when the cursor lands outside any token', () => {
    const src = 'export let count = 0'
    // Col 6 — whitespace between `export` and `let`.
    expect(completionsAtTuPosition(src, join(tmp, 'ws.tu'), 0, 6)).toEqual([])
  })
})
