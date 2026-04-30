import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkTuSource } from '../src/diagnostics.js'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'tu-lsp-imports-'))
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('checkTuSource — cross-`.tu` import resolution', () => {
  it('clean cross-file composition produces zero diagnostics', () => {
    const cardPath = join(tmp, 'Card.tu')
    writeFileSync(cardPath, 'export let Card = (label: string) => p { label }\n')
    const appPath = join(tmp, 'App.tu')
    const appSrc = [
      'import { Card } from "./Card.tu"',
      'export let App = () => Card("hi")',
    ].join('\n')
    expect(checkTuSource(appSrc, appPath)).toEqual([])
  })

  it('passing the wrong arg type to an imported component errors at the call site', () => {
    const cardPath = join(tmp, 'Card.tu')
    writeFileSync(cardPath, 'export let Card = (label: string) => p { label }\n')
    const appPath = join(tmp, 'App.tu')
    const appSrc = [
      'import { Card } from "./Card.tu"',
      'export let App = () => Card(42)',
    ].join('\n')
    const diags = checkTuSource(appSrc, appPath)
    expect(diags.length).toBeGreaterThan(0)
    // Error lands on the App line (1, 0-based) — where Card(42) is called.
    expect(diags[0]?.line).toBe(1)
    expect(diags[0]?.message.toLowerCase()).toMatch(/number|string/)
  })

  it('importing from a file that does not exist surfaces a cannot-find-module error', () => {
    const appPath = join(tmp, 'App.tu')
    const appSrc = [
      'import { Ghost } from "./Missing.tu"',
      'export let App = () => Ghost()',
    ].join('\n')
    const diags = checkTuSource(appSrc, appPath)
    expect(diags.length).toBeGreaterThan(0)
    // Error lands on the import line (line 0) — that's where the missing
    // module is referenced.
    const importErr = diags.find((d) => d.message.toLowerCase().includes('cannot find module'))
    expect(importErr).toBeDefined()
    expect(importErr?.line).toBe(0)
  })

  it('re-exports pass through types correctly', () => {
    // Card.tu: source of truth
    writeFileSync(join(tmp, 'Card.tu'), 'export let Card = (label: string) => p { label }\n')
    // index.tu: re-exports Card
    writeFileSync(
      join(tmp, 'index.tu'),
      'export { Card } from "./Card.tu"\n'
    )
    // App.tu: imports Card via the re-export
    const appPath = join(tmp, 'App.tu')
    const goodSrc = [
      'import { Card } from "./index.tu"',
      'export let App = () => Card("hello")',
    ].join('\n')
    expect(checkTuSource(goodSrc, appPath)).toEqual([])
    // Same scenario with a wrong arg type — should still error at App's call site.
    const badSrc = [
      'import { Card } from "./index.tu"',
      'export let App = () => Card(42)',
    ].join('\n')
    const diags = checkTuSource(badSrc, appPath)
    expect(diags.length).toBeGreaterThan(0)
    expect(diags[0]?.line).toBe(1)
  })

  it('cycles are tolerated (a imports b imports a)', () => {
    // Slightly contrived but valid: two .tu files each export something the
    // other imports. The BFS should terminate via the seen-set.
    writeFileSync(
      join(tmp, 'A.tu'),
      [
        'import { useB } from "./B.tu"',
        'export let useA = () => "from A"',
        'export let viaB = () => useB()',
      ].join('\n')
    )
    writeFileSync(
      join(tmp, 'B.tu'),
      [
        'import { useA } from "./A.tu"',
        'export let useB = () => "from B"',
        'export let viaA = () => useA()',
      ].join('\n')
    )
    // Run on A — should resolve B's exports via the cycle.
    const aSrc = [
      'import { useB } from "./B.tu"',
      'export let useA = () => "from A"',
      'export let viaB = () => useB()',
    ].join('\n')
    const diags = checkTuSource(aSrc, join(tmp, 'A.tu'))
    expect(diags).toEqual([])
  })
})
