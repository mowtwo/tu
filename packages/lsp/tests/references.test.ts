import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { disposeSessionCache } from '../src/lsp-session.js'
import { referencesAtTuPosition } from '../src/references.js'

let tmp: string
beforeEach(() => {
  disposeSessionCache()
  tmp = mkdtempSync(join(tmpdir(), 'tu-lsp-refs-'))
})
afterEach(() => {
  disposeSessionCache()
  rmSync(tmp, { recursive: true, force: true })
})

describe('referencesAtTuPosition — find all references to a Tu identifier', () => {
  it('lists every reference of a state cell in the same file (decl + reads)', () => {
    const src = ['export let count = 0', 'export let App = () => p { count }'].join('\n')
    const filename = join(tmp, 'state.tu')
    const refs = referencesAtTuPosition(src, filename, 0, 12)
    expect(refs.length).toBeGreaterThanOrEqual(2)
    for (const r of refs) {
      expect(r.uri).toContain('state.tu')
      expect(r.length).toBe(5) // `count`
    }
    // Lines hit: 0 (decl) and 1 (read).
    const lines = new Set(refs.map((r) => r.line))
    expect(lines.has(0)).toBe(true)
    expect(lines.has(1)).toBe(true)
    // At least one reference is the definition site.
    expect(refs.some((r) => r.isDefinition)).toBe(true)
  })

  it('excludes the declaration when includeDeclaration: false', () => {
    const src = ['export let count = 0', 'export let App = () => p { count }'].join('\n')
    const filename = join(tmp, 'state.tu')
    const refs = referencesAtTuPosition(src, filename, 0, 12, { includeDeclaration: false })
    expect(refs.every((r) => !r.isDefinition)).toBe(true)
    // Should still find the body reference.
    expect(refs.some((r) => r.line === 1)).toBe(true)
  })

  it('lists references across `.tu` files', () => {
    const cardPath = join(tmp, 'Card.tu')
    writeFileSync(cardPath, 'export let Card = (label: string) => p { label }\n')
    const appPath = join(tmp, 'App.tu')
    const appSrc = [
      'import { Card } from "./Card.tu"',
      'export let App = () => Card("hi")',
    ].join('\n')
    const refs = referencesAtTuPosition(appSrc, appPath, 1, 24)
    // Card.tu decl, App.tu import, App.tu call — at least 3 distinct refs.
    expect(refs.length).toBeGreaterThanOrEqual(3)
    const cardRefs = refs.filter((r) => r.uri.endsWith('Card.tu'))
    const appRefs = refs.filter((r) => r.uri.endsWith('App.tu'))
    expect(cardRefs.length).toBeGreaterThanOrEqual(1)
    expect(appRefs.length).toBeGreaterThanOrEqual(2)
    // The Card.tu declaration is the definition site.
    expect(cardRefs.some((r) => r.isDefinition)).toBe(true)
  })

  it('returns [] when the cursor is on a literal / keyword / whitespace', () => {
    const src = 'export let count = 0'
    // Col 19 — the `0` literal.
    expect(referencesAtTuPosition(src, join(tmp, 'lit.tu'), 0, 19)).toEqual([])
  })

  it('returns [] for a malformed source (compile failure)', () => {
    const src = 'export let count = ('
    expect(referencesAtTuPosition(src, join(tmp, 'bad.tu'), 0, 12)).toEqual([])
  })
})
