import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { definitionAtTuPosition } from '../src/definition.js'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'tu-lsp-definition-'))
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('definitionAtTuPosition — goto-definition at a .tu cursor', () => {
  it('jumps to a same-file state cell declaration', () => {
    // Source layout:
    //   line 0: export let count = 0
    //                       ^cols 11..15 = `count`
    //   line 1: export let App = () => p { count }
    //                                       ^cols 27..32 = `count` read
    const src = ['export let count = 0', 'export let App = () => p { count }'].join('\n')
    const filename = join(tmp, 'state.tu')
    // Cursor on the `count` read at line 1 col 28.
    const defs = definitionAtTuPosition(src, filename, 1, 28)
    expect(defs).toHaveLength(1)
    const d = defs[0]!
    expect(d.uri).toContain('state.tu')
    expect(d.line).toBe(0)
    // Definition lands on the bound `count` ident, cols 11..15.
    expect(d.col).toBe(11)
    expect(d.length).toBe(5)
  })

  it('jumps across `.tu` files for an imported component', () => {
    const cardPath = join(tmp, 'Card.tu')
    writeFileSync(cardPath, 'export let Card = (label: string) => p { label }\n')
    const appPath = join(tmp, 'App.tu')
    const appSrc = [
      'import { Card } from "./Card.tu"',
      'export let App = () => Card("hi")',
    ].join('\n')
    // Hover on `Card` at the call site (line 1 col 24).
    const defs = definitionAtTuPosition(appSrc, appPath, 1, 24)
    expect(defs.length).toBeGreaterThanOrEqual(1)
    const cardDef = defs.find((d) => d.uri.endsWith('Card.tu'))
    expect(cardDef).toBeDefined()
    expect(cardDef!.line).toBe(0)
    // The `Card` binding is at cols 11..15 in Card.tu.
    expect(cardDef!.col).toBe(11)
    expect(cardDef!.length).toBe(4)
  })

  it('returns [] when the cursor is on a literal or whitespace', () => {
    const src = 'export let count = 0'
    // Col 17 = `=` (no token mapping).
    expect(definitionAtTuPosition(src, join(tmp, 'lit.tu'), 0, 17)).toEqual([])
  })

  it('returns [] when the source has a Tu compile error', () => {
    const src = 'export let App = () => h1 { "unclosed'
    expect(definitionAtTuPosition(src, join(tmp, 'broken.tu'), 0, 12)).toEqual([])
  })

  // ─── M9 LSP — type-name goto-def ──────────────────────────────────

  it('M9: cursor on an interface name in a type annotation jumps to the interface decl', () => {
    const src = [
      'interface User { id: number; name: string }',
      'export let alice: User = { id: 1, name: "x" }',
    ].join('\n')
    // Cursor on `User` in the annotation `: User` (line 1, col 19).
    const defs = definitionAtTuPosition(src, join(tmp, 'a.tu'), 1, 19)
    expect(defs.length).toBeGreaterThan(0)
    // Defs should land on the interface decl line (line 0).
    expect(defs.some((d) => d.line === 0)).toBe(true)
  })

  it('M9: cursor on imported interface name jumps cross-file', () => {
    const userPath = join(tmp, 'user.tu')
    writeFileSync(userPath, 'export interface User { id: number }\n')
    const appPath = join(tmp, 'App.tu')
    const appSrc = [
      'import { User } from "./user.tu"',
      'export let bob: User = { id: 2 }',
    ].join('\n')
    // Cursor on `User` in the type annotation `: User`.
    const defs = definitionAtTuPosition(appSrc, appPath, 1, 17)
    expect(defs.length).toBeGreaterThan(0)
    // Accept any definition pointing at user.tu.
    expect(defs.some((d) => d.uri.endsWith('user.tu'))).toBe(true)
  })
})
