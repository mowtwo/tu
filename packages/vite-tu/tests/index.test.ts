import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import tu, { tuBundle, VERSION } from '../src/index.js'
import { importedNameKindsFor } from '../src/import-kinds.js'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'tu-vite-'))
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('@tu-lang/vite', () => {
  it('exposes a version', () => {
    expect(VERSION).toBe('0.0.0')
  })

  it('classifies default imports from default-exported Tu cells', () => {
    const cellPath = join(tmp, 'cell.tu')
    writeFileSync(cellPath, 'export default let count = 0\n')
    const src = 'import count from "./cell.tu"\nexport let App = () => p { count }\n'
    const kinds = importedNameKindsFor(src, join(tmp, 'App.tu'))
    expect(kinds?.get('count')).toBe('state')
  })

  it('exports a default plugin factory returning a named plugin', () => {
    const plugin = tu()
    expect(plugin.name).toBe('vite-tu')
    expect(plugin.enforce).toBe('pre')
    expect(typeof plugin.load).toBe('function')
  })

  it('load() compiles a .tu file to ESM', async () => {
    const file = join(tmp, 'Greet.tu')
    writeFileSync(file, 'export let Greet = (name: string) => p { name }\n')
    const plugin = tu()
    const load = plugin.load as (
      this: unknown,
      id: string
    ) => Promise<{ code: string; map: null } | null>
    const result = await load.call({}, file)
    expect(result).not.toBeNull()
    expect(result!.code).toContain(`import { h, Signal } from '@tu-lang/runtime'`)
    expect(result!.code).toContain(`export const Greet = (name) => h("p", {}, [name])`)
  })

  it('load() ignores non-.tu files', async () => {
    const plugin = tu()
    const load = plugin.load as (this: unknown, id: string) => Promise<unknown>
    expect(await load.call({}, '/some/path/foo.js')).toBeNull()
    expect(await load.call({}, '/some/path/foo.ts')).toBeNull()
    expect(await load.call({}, '/some/path/foo.tsx')).toBeNull()
  })

  it('load() strips a Vite-style ?query suffix before matching', async () => {
    const file = join(tmp, 'X.tu')
    writeFileSync(file, 'export let X = "hi"\n')
    const plugin = tu()
    const load = plugin.load as (
      this: unknown,
      id: string
    ) => Promise<{ code: string } | null>
    const result = await load.call({}, `${file}?import`)
    expect(result).not.toBeNull()
    expect(result!.code).toContain('export const X = new Signal.State("hi")')
  })

  it('respects a custom include regex', async () => {
    const file = join(tmp, 'X.tuf')
    writeFileSync(file, 'export let X = "hi"\n')
    const plugin = tu({ include: /\.tuf$/ })
    const load = plugin.load as (
      this: unknown,
      id: string
    ) => Promise<{ code: string } | null>
    const result = await load.call({}, file)
    expect(result).not.toBeNull()
    expect(result!.code).toContain('export const X')
  })

  it('M2.3: load() resolves an imported state cell so reads emit `.get()`', async () => {
    const cellPath = join(tmp, 'cell.tu')
    writeFileSync(cellPath, 'export let count = 0\n')
    const appPath = join(tmp, 'App.tu')
    writeFileSync(
      appPath,
      'import { count } from "./cell.tu"\nexport let App = () => p { count }\n'
    )
    const plugin = tu()
    const load = plugin.load as (this: unknown, id: string) => Promise<{ code: string } | null>
    const result = await load.call({}, appPath)
    expect(result).not.toBeNull()
    // Pre-M2.3, this would be `[count]` (broken reactivity). Post-fix:
    expect(result!.code).toContain('count.get()')
  })

  it('load() returns a V3 source map alongside the code', async () => {
    const file = join(tmp, 'M.tu')
    writeFileSync(file, 'let count = 0\n')
    const plugin = tu()
    const load = plugin.load as (
      this: unknown,
      id: string
    ) => Promise<{ code: string; map: { version: number; sources: string[]; sourcesContent: string[] } } | null>
    const result = await load.call({}, file)
    expect(result).not.toBeNull()
    expect(result!.map.version).toBe(3)
    expect(result!.map.sources).toEqual([file])
    expect(result!.map.sourcesContent[0]).toContain('let count = 0')
  })

  // ─── M8 Phase 6 — tuBundle() canonicalize plugin ───────────────────

  it('tuBundle returns a named plugin with the expected hooks', () => {
    const plugin = tuBundle()
    expect(plugin.name).toBe('vite-tu-bundle')
    expect(plugin.enforce).toBe('pre')
    expect(typeof plugin.buildStart).toBe('function')
    expect(typeof plugin.resolveId).toBe('function')
    expect(typeof plugin.load).toBe('function')
  })

  it('tuBundle canonicalizes a multi-file project + serves the shared module', async () => {
    // Two .tu files declaring same-shape interfaces — should merge to ONE
    // canonical descriptor in the shared module.
    writeFileSync(join(tmp, 'a.tu'), 'export interface User { id: number; name: string }\n')
    writeFileSync(join(tmp, 'b.tu'), 'export interface Person { id: number; name: string }\n')
    const plugin = tuBundle({ root: tmp, dev: true })
    // configResolved fires before buildStart in real Vite; mock it.
    const configResolved = plugin.configResolved as
      | ((this: unknown, c: { root: string; command: 'serve' | 'build' }) => void)
      | undefined
    configResolved!.call({}, { root: tmp, command: 'build' })
    const buildStart = plugin.buildStart as (this: unknown) => Promise<void>
    await buildStart.call({})
    // resolveId for the shared module returns the internal id.
    const resolveId = plugin.resolveId as (
      this: unknown,
      id: string
    ) => string | null
    const sharedId = resolveId.call({}, './__tu_types.generated.js')
    expect(sharedId).toBeTruthy()
    // load returns the shared module's emitted code.
    const load = plugin.load as (
      this: unknown,
      id: string
    ) => null | string | { code: string; map: unknown }
    const sharedOut = load.call({}, sharedId!)
    expect(typeof sharedOut).toBe('string')
    expect(sharedOut as string).toContain('export const User')
    // load on a per-file path returns its bundled output (with canonical refs).
    const aOut = load.call({}, join(tmp, 'a.tu')) as { code: string }
    expect(aOut).toBeTruthy()
    expect(aOut.code).toContain(`from "./__tu_types.generated.js"`)
    expect(aOut.code).toContain('User = __tu_canon_User')
  })

  it('tuBundle skips canonicalization in dev mode by default (per-file fallback)', async () => {
    writeFileSync(join(tmp, 'a.tu'), 'export interface X { y: number }\n')
    const plugin = tuBundle({ root: tmp })
    // dev (serve) mode without `dev: true` opt-in → no rebuild.
    const configResolved = plugin.configResolved as
      | ((this: unknown, c: { root: string; command: 'serve' | 'build' }) => void)
      | undefined
    configResolved!.call({}, { root: tmp, command: 'serve' })
    const buildStart = plugin.buildStart as (this: unknown) => Promise<void>
    await buildStart.call({})
    // load returns null — falls through to base tu() plugin.
    const load = plugin.load as (this: unknown, id: string) => unknown
    const fileOut = load.call({}, join(tmp, 'a.tu'))
    expect(fileOut).toBeNull()
  })
})
