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
    expect(bundle.files.size).toBe(2)
    expect(bundle.sharedModule.path).toBe('__tu_types.generated.ts')
    // M8 Phase 6 named-preference: first-encountered named origin
    // wins → the canonical export is `User`, not `T_…`.
    expect(bundle.sharedModule.code).toContain('export const User')
    expect(bundle.sharedModule.code).toContain(`import { type } from '@tu-lang/std'`)
    const aOut = bundle.files.get('a.tu')!.code
    const bOut = bundle.files.get('b.tu')!.code
    expect(aOut).toContain('./__tu_types.generated.ts')
    expect(bOut).toContain('./__tu_types.generated.ts')
    expect(aOut).toContain('export const User =')
    expect(bOut).toContain('export const Person =')
    const stripMap = (s: string) => s.split('//#')[0]!
    const aClean = stripMap(aOut)
    const bClean = stripMap(bOut)
    // Both files alias to the SAME canonical name (User), via the
    // `__tu_canon_` prefix to avoid name collision with the local
    // interface declaration.
    expect(aClean).toContain('User = __tu_canon_User')
    expect(bClean).toContain('Person = __tu_canon_User')
    expect(bundle.canonical.descriptors).toHaveLength(1)
  })

  it('two distinct shapes get two distinct canonical entries; no spurious merge', () => {
    const inputs: BundleInput[] = [
      { filename: 'pos.tu', source: 'export interface Pos { x: number; y: number }' },
      { filename: 'tag.tu', source: 'export interface Tag { name: string }' },
    ]
    const bundle = compileBundle(inputs)
    expect(bundle.canonical.descriptors).toHaveLength(2)
    expect(bundle.sharedModule.code).toContain('export const Pos')
    expect(bundle.sharedModule.code).toContain('export const Tag')
  })

  it('ReScript-style: anon let shape matching a named interface aliases to the named canonical', () => {
    const inputs: BundleInput[] = [
      { filename: 'user.tu', source: 'export interface User { id: number; name: string }' },
      { filename: 'app.tu', source: 'let bob = { id: 2, name: "Bob" }' },
    ]
    const bundle = compileBundle(inputs)
    // ONE descriptor — the named User — and the anon let aliases to it.
    expect(bundle.canonical.descriptors).toHaveLength(1)
    expect(bundle.canonical.descriptors[0]!.canonicalName).toBe('User')
    // Shared module exports User (no T_ entry).
    expect(bundle.sharedModule.code).toContain('export const User')
    expect(bundle.sharedModule.code).not.toMatch(/export const T_/)
    // app.tu's anon let aliases to the canonical (via the
    // `__tu_canon_` import prefix that avoids name collisions).
    const appOut = bundle.files.get('app.tu')!.code
    expect(appOut).toMatch(/const __tu_anon_\d+ = __tu_canon_User/)
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
    expect(oneOut).toMatch(/const __tu_anon_\d+ = __tu_canon_T_\d+_[0-9a-f]+/)
    expect(twoOut).toMatch(/const __tu_anon_\d+ = __tu_canon_T_\d+_[0-9a-f]+/)
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
    expect(bundle.sharedModule.code).toMatch(/export const User: __tu_TypeDescriptor/)
    // Per-file TS still has the local interface decl (drives tsserver).
    const aOut = bundle.files.get('a.tu')!.code
    expect(aOut).toContain('interface User {')
    expect(aOut).toContain('export const User: __tu_TypeDescriptor =')
  })

  it('M9 Phase D: TS bundle infers exported lambda params from direct cross-file callsites', () => {
    const inputs: BundleInput[] = [
      {
        filename: 'components/Card.tu',
        source: 'export let Card = (props) => props.title',
      },
      {
        filename: 'app/App.tu',
        source: [
          'import { Card } from "../components/Card.tu"',
          'export let App = () => Card({ title: "Tu", count: 1 })',
        ].join('\n'),
      },
    ]
    const bundle = compileBundle(inputs, { emitTS: true })
    const cardOut = bundle.files.get('components/Card.tu')!.code
    expect(cardOut).toContain('export const Card = (props: { title: string; count: number }) =>')
  })

  it('M9 Phase D: TS bundle widens exported lambda params across files', () => {
    const inputs: BundleInput[] = [
      {
        filename: 'lib/echo.tu',
        source: 'export let echo = (value) => value',
      },
      {
        filename: 'a.tu',
        source: 'import { echo } from "./lib/echo.tu"\nlet a = echo(1)',
      },
      {
        filename: 'b.tu',
        source: 'import { echo } from "./lib/echo.tu"\nlet b = echo("two")',
      },
    ]
    const bundle = compileBundle(inputs, { emitTS: true })
    const echoOut = bundle.files.get('lib/echo.tu')!.code
    expect(echoOut).toContain('export const echo = (value: number | string) =>')
  })

  it('M9 Phase D: TS bundle follows re-exported cross-file callsites', () => {
    const inputs: BundleInput[] = [
      {
        filename: 'components/Card.tu',
        source: 'export let Card = (props) => props.title',
      },
      {
        filename: 'components/index.tu',
        source: 'export { Card } from "./Card.tu"',
      },
      {
        filename: 'app/App.tu',
        source: [
          'import { Card } from "../components/index.tu"',
          'export let App = () => Card({ title: "Tu" })',
        ].join('\n'),
      },
    ]
    const bundle = compileBundle(inputs, { emitTS: true })
    const cardOut = bundle.files.get('components/Card.tu')!.code
    expect(cardOut).toContain('export const Card = (props: { title: string }) =>')
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
