import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import tu, { VERSION } from '../src/index.js'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'tu-vite-'))
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('@tu/vite', () => {
  it('exposes a version', () => {
    expect(VERSION).toBe('0.0.0')
  })

  it('exports a default plugin factory returning a named plugin', () => {
    const plugin = tu()
    expect(plugin.name).toBe('vite-tu')
    expect(plugin.enforce).toBe('pre')
    expect(typeof plugin.load).toBe('function')
  })

  it('load() compiles a .tu file to ESM', async () => {
    const file = join(tmp, 'Greet.tu')
    writeFileSync(file, 'let Greet = (name: string) => p { name }\n')
    const plugin = tu()
    const load = plugin.load as (
      this: unknown,
      id: string
    ) => Promise<{ code: string; map: null } | null>
    const result = await load.call({}, file)
    expect(result).not.toBeNull()
    expect(result!.code).toContain(`import { h, Signal } from '@tu/runtime'`)
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
    writeFileSync(file, 'let X = "hi"\n')
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
    writeFileSync(file, 'let X = "hi"\n')
    const plugin = tu({ include: /\.tuf$/ })
    const load = plugin.load as (
      this: unknown,
      id: string
    ) => Promise<{ code: string } | null>
    const result = await load.call({}, file)
    expect(result).not.toBeNull()
    expect(result!.code).toContain('export const X')
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
})
