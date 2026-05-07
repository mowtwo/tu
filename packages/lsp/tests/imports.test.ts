import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { definitionAtTuPosition } from '../src/definition.js'
import { checkTuSource } from '../src/diagnostics.js'
import { hoverAtTuPosition } from '../src/hover.js'
import { disposeSessionCache } from '../src/lsp-session.js'

let tmp: string
beforeEach(() => {
  disposeSessionCache()
  tmp = mkdtempSync(join(tmpdir(), 'tu-lsp-imports-'))
})
afterEach(() => {
  disposeSessionCache()
  rmSync(tmp, { recursive: true, force: true })
})

describe('checkTuSource — cross-`.tu` import resolution', () => {
  it('clean cross-file composition produces zero diagnostics', () => {
    const cardPath = join(tmp, 'Card.tu')
    writeFileSync(cardPath, 'export let Card = (props: { label?: string }) => p { props.label }\n')
    const appPath = join(tmp, 'App.tu')
    const appSrc = [
      'import { Card } from "./Card.tu"',
      'export let App = () => Card(label: "hi")',
    ].join('\n')
    expect(checkTuSource(appSrc, appPath)).toEqual([])
  })

  it('passing the wrong arg type to an imported component errors at the call site', () => {
    const cardPath = join(tmp, 'Card.tu')
    writeFileSync(cardPath, 'export let Card = (props: { label?: string }) => p { props.label }\n')
    const appPath = join(tmp, 'App.tu')
    const appSrc = [
      'import { Card } from "./Card.tu"',
      'export let App = () => Card(label: 42)',
    ].join('\n')
    const diags = checkTuSource(appSrc, appPath)
    expect(diags.length).toBeGreaterThan(0)
    // Error lands on the App line (1, 0-based) — where Card(label: 42) is called.
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
    writeFileSync(join(tmp, 'Card.tu'), 'export let Card = (props: { label?: string }) => p { props.label }\n')
    // index.tu: re-exports Card
    writeFileSync(
      join(tmp, 'index.tu'),
      'export { Card } from "./Card.tu"\n'
    )
    // App.tu: imports Card via the re-export
    const appPath = join(tmp, 'App.tu')
    const goodSrc = [
      'import { Card } from "./index.tu"',
      'export let App = () => Card(label: "hello")',
    ].join('\n')
    expect(checkTuSource(goodSrc, appPath)).toEqual([])
    // Same scenario with a wrong arg type — should still error at App's call site.
    const badSrc = [
      'import { Card } from "./index.tu"',
      'export let App = () => Card(label: 42)',
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

  it('M9: default-importing a state cell across files reads via `.get()`', async () => {
    const cellPath = join(tmp, 'cell.tu')
    writeFileSync(cellPath, 'export default let count = 0\n')
    const appPath = join(tmp, 'App.tu')
    const appSrc = [
      'import count from "./cell.tu"',
      'export let App = () => p { count }',
    ].join('\n')
    const { buildShadowGraph, tuPathToTs } = await import('../src/shadow-graph.js')
    const shadows = buildShadowGraph(appSrc, appPath)
    const appShadow = shadows.get(tuPathToTs(appPath))!
    expect(appShadow.ts).toContain('count.get()')
  })

  it('M9 Phase D: imported untyped lambdas infer params from cross-file callsites', async () => {
    const { buildShadowGraph, tuPathToTs } = await import('../src/shadow-graph.js')
    const cardPath = join(tmp, 'Card.tu')
    writeFileSync(cardPath, 'export let Card = (props) => props.title\n')
    const appPath = join(tmp, 'App.tu')
    const appSrc = [
      'import { Card } from "./Card.tu"',
      'export let App = () => Card({ title: "Tu", count: 1 })',
    ].join('\n')
    const shadows = buildShadowGraph(appSrc, appPath)
    const cardShadow = shadows.get(tuPathToTs(cardPath))!
    expect(cardShadow.ts).toContain('export const Card = (props: { title: string; count: number }) =>')
  })

  it('M9 Phase D: re-exported untyped lambdas infer params from cross-file callsites', async () => {
    const { buildShadowGraph, tuPathToTs } = await import('../src/shadow-graph.js')
    const cardPath = join(tmp, 'Card.tu')
    writeFileSync(cardPath, 'export let Card = (props) => props.title\n')
    writeFileSync(join(tmp, 'index.tu'), 'export { Card } from "./Card.tu"\n')
    const appPath = join(tmp, 'App.tu')
    const appSrc = [
      'import { Card } from "./index.tu"',
      'export let App = () => Card({ title: "Tu" })',
    ].join('\n')
    const shadows = buildShadowGraph(appSrc, appPath)
    const cardShadow = shadows.get(tuPathToTs(cardPath))!
    expect(cardShadow.ts).toContain('export const Card = (props: { title: string }) =>')
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

  // ─── M8 Phase 3c — cross-`.tu` imported interface tagging ────────────

  it('imported interface name participates in typed-let tag injection', async () => {
    // Compile App.tu through the SHADOW GRAPH (LSP path) so the
    // importedInterfaceNames option flows. The compiler-only path
    // wouldn't see this — that's why Phase 2.5 was conservative.
    const { buildShadowGraph, tuPathToTs } = await import('../src/shadow-graph.js')
    const userPath = join(tmp, 'user.tu')
    writeFileSync(userPath, 'export interface User { id: number; name: string }\n')
    const appPath = join(tmp, 'App.tu')
    const appSrc = [
      'import { User } from "./user.tu"',
      'export let bob: User = { id: 2, name: "Bob" }',
    ].join('\n')
    const shadows = buildShadowGraph(appSrc, appPath)
    const appShadow = shadows.get(tuPathToTs(appPath))!
    expect(appShadow).toBeDefined()
    // Phase 3c: typed `let bob: User = …` now wraps with `type.tag(User, …)`
    // because the shadow-graph identified `User` as an imported interface.
    expect(appShadow.ts).toContain('type.tag(User, { id: 2, name: "Bob" })')
    // The `type` namespace auto-imports because of the tag injection.
    expect(appShadow.ts).toContain(`from '@tu-lang/std'`)
  })

  it('imported NON-interface name (type alias) still skips tagging', async () => {
    const { buildShadowGraph, tuPathToTs } = await import('../src/shadow-graph.js')
    const aliasPath = join(tmp, 'aliases.tu')
    writeFileSync(aliasPath, 'export type Variant = "a" | "b"\n')
    const appPath = join(tmp, 'App.tu')
    const appSrc = [
      'import { Variant } from "./aliases.tu"',
      'export let v: Variant = "a"',
    ].join('\n')
    const shadows = buildShadowGraph(appSrc, appPath)
    const appShadow = shadows.get(tuPathToTs(appPath))!
    expect(appShadow.ts).not.toContain('type.tag(Variant')
  })

  it('in-memory edits to a non-root file are seen by the root analysis', () => {
    // Disk version of Card.tu has the wrong signature.
    const cardPath = join(tmp, 'Card.tu')
    writeFileSync(cardPath, 'export let Card = (props: { count?: number }) => p { props.count }\n')
    const appPath = join(tmp, 'App.tu')
    const appSrc = [
      'import { Card } from "./Card.tu"',
      'export let App = () => Card(label: "hi")',
    ].join('\n')
    // Without an in-memory override, the disk Card expects a number — App
    // passing "hi" is a type error.
    const diagsDisk = checkTuSource(appSrc, appPath)
    expect(diagsDisk.length).toBeGreaterThan(0)
    // Now override Card.tu in-memory with a string-accepting version. The
    // analysis should pick up the in-memory text and pass clean.
    const inMem = new Map<string, string>([
      [cardPath, 'export let Card = (props: { label?: string }) => p { props.label }\n'],
    ])
    expect(checkTuSource(appSrc, appPath, inMem)).toEqual([])
  })

  // ─── M6.12 — hover / goto-def on the import-source string ───────────

  it('hover on the source string of an import shows resolved path + exports', () => {
    const cardPath = join(tmp, 'Card.tu')
    writeFileSync(
      cardPath,
      [
        'export let Card = (props: { label?: string }) => p { props.label }',
        'export let helper = (n: number) => n + 1',
      ].join('\n')
    )
    const appPath = join(tmp, 'App.tu')
    const appSrc = [
      'import { Card } from "./Card.tu"',
      'export let App = () => Card(label: "hi")',
    ].join('\n')
    // Cursor inside the quoted source on line 0.
    // `import { Card } from "./Card.tu"` — `"` starts at col 21, path runs
    // until col 31, closing quote at col 32. Land cursor on col 25 (mid-path).
    const hover = hoverAtTuPosition(appSrc, appPath, 0, 25)
    expect(hover).not.toBeNull()
    expect(hover!.contents).toContain('"./Card.tu"')
    expect(hover!.contents).toContain('Card.tu') // basename annotation
    // Export list surfaces in documentation.
    expect(hover!.documentation).toMatch(/Card/)
    expect(hover!.documentation).toMatch(/helper/)
  })

  it('goto-definition on the source string of an import jumps to the resolved file', () => {
    const cardPath = join(tmp, 'Card.tu')
    writeFileSync(cardPath, 'export let Card = (props: { label?: string }) => p { props.label }\n')
    const appPath = join(tmp, 'App.tu')
    const appSrc = [
      'import { Card } from "./Card.tu"',
      'export let App = () => Card(label: "hi")',
    ].join('\n')
    // Cursor mid-path of the import string on line 0.
    const defs = definitionAtTuPosition(appSrc, appPath, 0, 25)
    expect(defs.length).toBe(1)
    expect(defs[0]!.uri).toContain('Card.tu')
    expect(defs[0]!.line).toBe(0)
    expect(defs[0]!.col).toBe(0)
  })

  it('hover on import source path that does not exist on disk shows path-only', () => {
    const appPath = join(tmp, 'App.tu')
    const appSrc = [
      'import { Ghost } from "./Missing.tu"',
      'export let App = () => Ghost()',
    ].join('\n')
    // Cursor inside the import-source quotes.
    const hover = hoverAtTuPosition(appSrc, appPath, 0, 26)
    expect(hover).not.toBeNull()
    expect(hover!.contents).toContain('"./Missing.tu"')
    // Path doesn't exist → no exports list / reference to file body.
    expect(hover!.contents.includes('Missing.tu')).toBe(true)
  })

  it('hover on identifier in import statement is NOT shadowed by the import-source helper', () => {
    const cardPath = join(tmp, 'Card.tu')
    writeFileSync(cardPath, 'export let Card = (props: { label?: string }) => p { props.label }\n')
    const appPath = join(tmp, 'App.tu')
    const appSrc = [
      'import { Card } from "./Card.tu"',
      'export let App = () => Card(label: "hi")',
    ].join('\n')
    // Cursor on the call site `Card(label: "hi")` on line 1, col 23. Should
    // produce a TS-shaped hover (signature), not the path-module hover.
    const hover = hoverAtTuPosition(appSrc, appPath, 1, 24)
    expect(hover).not.toBeNull()
    // The import-source hover starts with `module "..."`. Confirm we
    // didn't mistakenly route THIS through the import-source path.
    expect(hover!.contents).not.toMatch(/^module /)
    // It should mention the lambda's signature.
    expect(hover!.contents).toMatch(/string/)
  })

  it('in-memory edits to non-root file invalidate stale cache from a prior disk-only check', () => {
    // First check uses disk version. Second check uses in-memory override
    // for the SAME root source — the cache must rebuild.
    const cardPath = join(tmp, 'Card.tu')
    writeFileSync(cardPath, 'export let Card = (props: { count?: number }) => p { props.count }\n')
    const appPath = join(tmp, 'App.tu')
    const appSrc = [
      'import { Card } from "./Card.tu"',
      'export let App = () => Card(label: "hi")',
    ].join('\n')
    expect(checkTuSource(appSrc, appPath).length).toBeGreaterThan(0)
    const inMem = new Map<string, string>([
      [cardPath, 'export let Card = (props: { label?: string }) => p { props.label }\n'],
    ])
    expect(checkTuSource(appSrc, appPath, inMem)).toEqual([])
    // And going back to disk-only should resurface the error (cache must
    // rebuild a third time).
    expect(checkTuSource(appSrc, appPath).length).toBeGreaterThan(0)
  })
})
