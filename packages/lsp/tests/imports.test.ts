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

  it('M2.3: importing a state cell across files now reads via `.get()`', async () => {
    // Pre-M2.3, importing `count` from another .tu silently lost its `.get()`
    // injection because the importing file's compiler couldn't classify
    // imported names. With cross-file kind propagation, the read now emits
    // `count.get()` in the TS shadow so reactivity works as expected.
    const cellPath = join(tmp, 'cell.tu')
    writeFileSync(cellPath, 'export let count = 0\n')
    const appPath = join(tmp, 'App.tu')
    const appSrc = [
      'import { count } from "./cell.tu"',
      'export let App = () => p { count }',
    ].join('\n')
    // Reach into the shadow-graph to inspect the emitted TS for App.tu.
    const { buildShadowGraph, tuPathToTs } = await import('../src/shadow-graph.js')
    const shadows = buildShadowGraph(appSrc, appPath)
    const appShadow = shadows.get(tuPathToTs(appPath))!
    expect(appShadow.ts).toContain('count.get()')
    expect(appShadow.ts).not.toMatch(/\[count\]/) // no bare-ident read
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

  // ─── M6.12 — in-memory multi-doc edits ───────────────────────────────

  it('in-memory edits to a non-root file are seen by the root analysis', () => {
    // Disk version of Card.tu has the wrong signature.
    const cardPath = join(tmp, 'Card.tu')
    writeFileSync(cardPath, 'export let Card = (count: number) => p { count }\n')
    const appPath = join(tmp, 'App.tu')
    const appSrc = [
      'import { Card } from "./Card.tu"',
      'export let App = () => Card("hi")',
    ].join('\n')
    // Without an in-memory override, the disk Card expects a number — App
    // passing "hi" is a type error.
    const diagsDisk = checkTuSource(appSrc, appPath)
    expect(diagsDisk.length).toBeGreaterThan(0)
    // Now override Card.tu in-memory with a string-accepting version. The
    // analysis should pick up the in-memory text and pass clean.
    const inMem = new Map<string, string>([
      [cardPath, 'export let Card = (label: string) => p { label }\n'],
    ])
    expect(checkTuSource(appSrc, appPath, inMem)).toEqual([])
  })

  it('in-memory edits to non-root file invalidate stale cache from a prior disk-only check', () => {
    // First check uses disk version. Second check uses in-memory override
    // for the SAME root source — the cache must rebuild.
    const cardPath = join(tmp, 'Card.tu')
    writeFileSync(cardPath, 'export let Card = (count: number) => p { count }\n')
    const appPath = join(tmp, 'App.tu')
    const appSrc = [
      'import { Card } from "./Card.tu"',
      'export let App = () => Card("hi")',
    ].join('\n')
    expect(checkTuSource(appSrc, appPath).length).toBeGreaterThan(0)
    const inMem = new Map<string, string>([
      [cardPath, 'export let Card = (label: string) => p { label }\n'],
    ])
    expect(checkTuSource(appSrc, appPath, inMem)).toEqual([])
    // And going back to disk-only should resurface the error (cache must
    // rebuild a third time).
    expect(checkTuSource(appSrc, appPath).length).toBeGreaterThan(0)
  })
})
