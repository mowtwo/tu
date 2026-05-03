import { describe, expect, it } from 'vitest'
import { compileBundle, type BundleInput } from '../src/index.js'

describe('M8 Phase 6b/6c — compileBundle()', () => {
  it('emits a shared canonical module + per-file outputs', () => {
    const inputs: BundleInput[] = [
      {
        filename: 'a.tu',
        source: 'export interface User { id: number; name: string }',
      },
      {
        filename: 'b.tu',
        source: 'export interface Person { id: number; name: string }',
      },
    ]
    const bundle = compileBundle(inputs)
    // Two files in, two files out.
    expect(bundle.files.size).toBe(2)
    // Shared module exists with the canonical descriptor.
    expect(bundle.sharedModule.path).toBe('__tu_types.generated.ts')
    expect(bundle.sharedModule.code).toContain('export const T_0_')
    expect(bundle.sharedModule.code).toContain(
      `import { type } from '@tu-lang/std'`
    )
    // Both files' canonical entries point to the SAME canonical name.
    const aOut = bundle.files.get('a.tu')!.code
    const bOut = bundle.files.get('b.tu')!.code
    // Each file imports the canonical from the shared module.
    expect(aOut).toContain('./__tu_types.generated.ts')
    expect(bOut).toContain('./__tu_types.generated.ts')
    // Each file's `User`/`Person` is now an alias to the same canonical name.
    expect(aOut).toContain('export const User =')
    expect(bOut).toContain('export const Person =')
    // Strip source map for cleaner inspection.
    const stripMap = (s: string) => s.split('//#')[0]!
    const aClean = stripMap(aOut)
    const bClean = stripMap(bOut)
    // Locate the canonical name from the shared module.
    const canonMatch = bundle.sharedModule.code.match(/export const (T_\d+_[0-9a-f]+)/)
    expect(canonMatch).toBeTruthy()
    const canonName = canonMatch![1]!
    // Both files reference it.
    expect(aClean).toContain(`User = ${canonName}`)
    expect(bClean).toContain(`Person = ${canonName}`)
    // Sanity: the shared module hash includes the SAME canonical for both
    // by virtue of merging — verified through `canonical.descriptors`.
    expect(bundle.canonical.descriptors).toHaveLength(1)
  })

  it('two distinct shapes get two distinct canonical entries; no spurious merge', () => {
    const inputs: BundleInput[] = [
      { filename: 'pos.tu', source: 'export interface Pos { x: number; y: number }' },
      { filename: 'tag.tu', source: 'export interface Tag { name: string }' },
    ]
    const bundle = compileBundle(inputs)
    expect(bundle.canonical.descriptors).toHaveLength(2)
    // Shared module declares both.
    const matches = bundle.sharedModule.code.match(/export const T_\d+_[0-9a-f]+/g) ?? []
    expect(matches).toHaveLength(2)
  })

  it('anonymous let shapes participate in cross-file merge', () => {
    const inputs: BundleInput[] = [
      { filename: 'one.tu', source: 'let p = { x: 1, y: 2 }' },
      { filename: 'two.tu', source: 'let q = { x: 10, y: 20 }' },
    ]
    const bundle = compileBundle(inputs)
    // ONE canonical entry for the two same-shape anon literals.
    expect(bundle.canonical.descriptors).toHaveLength(1)
    // Both files alias their `__tu_anon_N` to the canonical.
    const oneOut = bundle.files.get('one.tu')!.code
    const twoOut = bundle.files.get('two.tu')!.code
    expect(oneOut).toContain('./__tu_types.generated.ts')
    expect(twoOut).toContain('./__tu_types.generated.ts')
    expect(oneOut).toMatch(/const __tu_anon_\d+ = T_\d+_[0-9a-f]+/)
    expect(twoOut).toMatch(/const __tu_anon_\d+ = T_\d+_[0-9a-f]+/)
  })

  it('TS emit mode includes the type-side annotation in the shared module', () => {
    const inputs: BundleInput[] = [
      {
        filename: 'a.tu',
        source: 'export interface User { id: number }',
      },
    ]
    const bundle = compileBundle(inputs, { emitTS: true })
    expect(bundle.sharedModule.code).toContain('TypeDescriptor as __tu_TypeDescriptor')
    expect(bundle.sharedModule.code).toMatch(/export const T_\d+_[0-9a-f]+: __tu_TypeDescriptor/)
    // Per-file TS still has the local interface decl (drives tsserver).
    const aOut = bundle.files.get('a.tu')!.code
    expect(aOut).toContain('interface User {')
    expect(aOut).toContain('export const User: __tu_TypeDescriptor =')
  })

  it('respects sharedImportPath / sharedOutputPath options', () => {
    const inputs: BundleInput[] = [
      { filename: 'a.tu', source: 'export interface X { a: number }' },
    ]
    const bundle = compileBundle(inputs, {
      sharedImportPath: '@my-app/types',
      sharedOutputPath: 'dist/types.js',
    })
    expect(bundle.sharedModule.path).toBe('dist/types.js')
    expect(bundle.files.get('a.tu')!.code).toContain(`from "@my-app/types"`)
  })

  it('header comment annotates each canonical descriptor with its origins', () => {
    const inputs: BundleInput[] = [
      { filename: 'a.tu', source: 'export interface Card { title: string }' },
      { filename: 'b.tu', source: 'export interface Pill { title: string }' },
    ]
    const bundle = compileBundle(inputs)
    expect(bundle.sharedModule.code).toContain('a.tu::Card')
    expect(bundle.sharedModule.code).toContain('b.tu::Pill')
  })

  it('empty bundle returns empty result', () => {
    const bundle = compileBundle([])
    expect(bundle.files.size).toBe(0)
    expect(bundle.canonical.descriptors).toHaveLength(0)
    // Shared module still emits the import header (idle but harmless;
    // build tools that detect zero descriptors can skip writing).
    expect(bundle.sharedModule.code).toContain('@tu-lang/std')
  })
})
