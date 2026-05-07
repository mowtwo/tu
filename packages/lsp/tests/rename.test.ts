import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { disposeSessionCache } from '../src/lsp-session.js'
import { renameAtTuPosition } from '../src/rename.js'

let tmp: string
beforeEach(() => {
  disposeSessionCache()
  tmp = mkdtempSync(join(tmpdir(), 'tu-lsp-rename-'))
})
afterEach(() => {
  disposeSessionCache()
  rmSync(tmp, { recursive: true, force: true })
})

describe('renameAtTuPosition — workspace edits for renaming a Tu identifier', () => {
  it('rewrites every reference of a state cell in the same file', () => {
    // Source:
    //   line 0: export let count = 0
    //                       ^-- ren on cols 11..15
    //   line 1: export let App = () => p { count }
    //                                       ^-- ref on cols 27..32
    const src = ['export let count = 0', 'export let App = () => p { count }'].join('\n')
    const filename = join(tmp, 'state.tu')
    const edits = renameAtTuPosition(src, filename, 0, 12, 'tally')
    // Two edits — the declaration + the reference.
    expect(edits.length).toBeGreaterThanOrEqual(2)
    for (const e of edits) {
      expect(e.uri).toContain('state.tu')
      expect(e.length).toBe(5) // `count`
      expect(e.newText).toBe('tally')
    }
    // Lines hit: 0 (decl) and 1 (ref).
    const lines = new Set(edits.map((e) => e.line))
    expect(lines.has(0)).toBe(true)
    expect(lines.has(1)).toBe(true)
  })

  it('rewrites references across `.tu` files', () => {
    const cardPath = join(tmp, 'Card.tu')
    writeFileSync(cardPath, 'export let Card = (label: string) => p { label }\n')
    const appPath = join(tmp, 'App.tu')
    const appSrc = [
      'import { Card } from "./Card.tu"',
      'export let App = () => Card("hi")',
    ].join('\n')
    // Rename `Card` from the call site (line 1, col 24).
    const edits = renameAtTuPosition(appSrc, appPath, 1, 24, 'Tile')
    // Card.tu's declaration and re-export, plus App.tu's import + call =
    // at least 3 edits (decl + import + call); could be more depending on
    // tsserver's reach.
    expect(edits.length).toBeGreaterThanOrEqual(3)
    const cardEdits = edits.filter((e) => e.uri.endsWith('Card.tu'))
    const appEdits = edits.filter((e) => e.uri.endsWith('App.tu'))
    expect(cardEdits.length).toBeGreaterThanOrEqual(1)
    expect(appEdits.length).toBeGreaterThanOrEqual(2)
    for (const e of edits) expect(e.newText).toBe('Tile')
  })

  it('M6.12: renames interface names from a lambda type annotation cursor', () => {
    const lines = [
      'interface User { id: number; name: string }',
      'export let alice: User = { id: 1, name: "Alice" }',
      'export let render = (u: User): User => p { u.name }',
    ]
    const src = lines.join('\n')
    const filename = join(tmp, 'types.tu')
    const edits = renameAtTuPosition(src, filename, 2, lines[2]!.indexOf('User'), 'Person')
    expect(edits.length).toBeGreaterThanOrEqual(4)
    expect(edits.every((e) => e.uri.endsWith('types.tu'))).toBe(true)
    expect(edits.every((e) => e.length === 4)).toBe(true)
    expect(edits.every((e) => e.newText === 'Person')).toBe(true)
    expect(edits.some((e) => e.line === 0 && e.col === 10)).toBe(true)
    expect(edits.some((e) => e.line === 1 && e.col === 18)).toBe(true)
    expect(edits.some((e) => e.line === 2 && e.col === 24)).toBe(true)
    expect(edits.some((e) => e.line === 2 && e.col === 31)).toBe(true)
  })

  it('rejects an invalid identifier', () => {
    const src = 'export let count = 0'
    expect(renameAtTuPosition(src, join(tmp, 'bad.tu'), 0, 12, 'with space')).toEqual([])
    expect(renameAtTuPosition(src, join(tmp, 'bad.tu'), 0, 12, '123abc')).toEqual([])
    expect(renameAtTuPosition(src, join(tmp, 'bad.tu'), 0, 12, '')).toEqual([])
  })

  it('returns [] when the cursor is on a literal', () => {
    const src = 'export let count = 0'
    // Col 19 — the `0` literal.
    expect(renameAtTuPosition(src, join(tmp, 'lit.tu'), 0, 19, 'tally')).toEqual([])
  })
})
