import { describe, expect, it } from 'vitest'
import { canonicalizeShapes, parse, tokenize } from '../src/index.js'
import type { Program } from '../src/index.js'

function programOf(src: string, filename = 'input.tu'): Program {
  return parse(tokenize(src, filename), src, filename)
}

describe('M8 Phase 6a — canonicalizeShapes()', () => {
  it('merges identical interfaces across two files', () => {
    const a = programOf('export interface User { id: number; name: string }', 'a.tu')
    const b = programOf('export interface Person { id: number; name: string }', 'b.tu')
    const programs = new Map<string, Program>([
      ['a.tu', a],
      ['b.tu', b],
    ])
    const result = canonicalizeShapes(programs)
    // ONE descriptor for both shapes (User and Person merge).
    expect(result.descriptors).toHaveLength(1)
    const desc = result.descriptors[0]!
    expect(desc.origins).toHaveLength(2)
    expect(desc.origins.map((o) => o.originalName).sort()).toEqual(['Person', 'User'])
    // Both files map their original name to the same canonical name.
    expect(result.perFile.get('a.tu')!.get('User')).toBe(desc.canonicalName)
    expect(result.perFile.get('b.tu')!.get('Person')).toBe(desc.canonicalName)
  })

  it('keeps differently-shaped interfaces separate', () => {
    const a = programOf('export interface User { id: number }', 'a.tu')
    const b = programOf('export interface Pos { x: number; y: number }', 'b.tu')
    const result = canonicalizeShapes(
      new Map([
        ['a.tu', a],
        ['b.tu', b],
      ])
    )
    expect(result.descriptors).toHaveLength(2)
  })

  it('field order does not matter for hashing', () => {
    const a = programOf('export interface A { x: number; y: number }', 'a.tu')
    const b = programOf('export interface B { y: number; x: number }', 'b.tu')
    const result = canonicalizeShapes(
      new Map([
        ['a.tu', a],
        ['b.tu', b],
      ])
    )
    expect(result.descriptors).toHaveLength(1)
  })

  it('field type matters for hashing', () => {
    const a = programOf('export interface A { x: number }', 'a.tu')
    const b = programOf('export interface B { x: string }', 'b.tu')
    const result = canonicalizeShapes(
      new Map([
        ['a.tu', a],
        ['b.tu', b],
      ])
    )
    expect(result.descriptors).toHaveLength(2)
  })

  it('optional flag is part of the hash', () => {
    const a = programOf('export interface A { x: number }', 'a.tu')
    const b = programOf('export interface B { x?: number }', 'b.tu')
    const result = canonicalizeShapes(
      new Map([
        ['a.tu', a],
        ['b.tu', b],
      ])
    )
    expect(result.descriptors).toHaveLength(2)
  })

  it('anonymous object-let shapes participate in canonicalization', () => {
    const a = programOf('let p = { x: 1, y: 2 }', 'a.tu')
    const b = programOf('let q = { x: 10, y: 20 }', 'b.tu')
    const result = canonicalizeShapes(
      new Map([
        ['a.tu', a],
        ['b.tu', b],
      ])
    )
    // Both anon-shapes share ONE descriptor.
    expect(result.descriptors).toHaveLength(1)
    expect(result.descriptors[0]!.origins).toHaveLength(2)
    // The original name surfaced is `__anon_<letName>`.
    const names = result.descriptors[0]!.origins.map((o) => o.originalName).sort()
    expect(names).toEqual(['__anon_p', '__anon_q'])
  })

  it('cross-kind merge: anon let shape == named interface with same fields', () => {
    const a = programOf('export interface Pos { x: number; y: number }', 'a.tu')
    const b = programOf('let here = { x: 1, y: 2 }', 'b.tu')
    const result = canonicalizeShapes(
      new Map([
        ['a.tu', a],
        ['b.tu', b],
      ])
    )
    // Both share one descriptor — anon and named merge structurally.
    expect(result.descriptors).toHaveLength(1)
    expect(result.descriptors[0]!.origins).toHaveLength(2)
  })

  it('untyped object lets with spread are skipped (Phase 3d work)', () => {
    const a = programOf(['let base = { x: 1 }', 'let spread = { ...base, y: 2 }'].join('\n'), 'a.tu')
    const result = canonicalizeShapes(new Map([['a.tu', a]]))
    // Only `base` is canonicalized; the spread literal is opaque.
    const fileMap = result.perFile.get('a.tu')!
    expect(fileMap.has('__anon_base')).toBe(true)
    expect(fileMap.has('__anon_spread')).toBe(false)
  })

  it('canonical name embeds the hash so collisions are unambiguous', () => {
    const a = programOf('export interface A { id: number }', 'a.tu')
    const result = canonicalizeShapes(new Map([['a.tu', a]]))
    const desc = result.descriptors[0]!
    expect(desc.canonicalName).toMatch(/^T_\d+_[0-9a-f]{8}$/)
    expect(desc.canonicalName).toContain(desc.hash.slice(0, 8))
  })

  it('sorts canonical fields by name for stable emit', () => {
    const a = programOf('export interface A { z: number; a: string; m: boolean }', 'a.tu')
    const result = canonicalizeShapes(new Map([['a.tu', a]]))
    const fields = result.descriptors[0]!.fields
    expect(fields.map((f) => f.name)).toEqual(['a', 'm', 'z'])
  })

  it('typed `let X: I = …` is not anon — the let does NOT enter as a separate shape', () => {
    // The `let alice: User` is just tagged with the existing `User`
    // descriptor at emit time; the canonicalizer should NOT register
    // a separate `__anon_alice` for it (otherwise we'd double-count
    // the User shape).
    const a = programOf(
      ['interface User { id: number }', 'let alice: User = { id: 1 }'].join('\n'),
      'a.tu'
    )
    const result = canonicalizeShapes(new Map([['a.tu', a]]))
    const fileMap = result.perFile.get('a.tu')!
    expect(fileMap.has('User')).toBe(true)
    expect(fileMap.has('__anon_alice')).toBe(false)
  })

  it('empty input produces an empty result', () => {
    const result = canonicalizeShapes(new Map())
    expect(result.descriptors).toEqual([])
    expect(result.perFile.size).toBe(0)
  })

  it('hashes are deterministic — same input twice yields same canonical names', () => {
    const a = programOf('export interface A { id: number; name: string }', 'a.tu')
    const r1 = canonicalizeShapes(new Map([['a.tu', a]]))
    const r2 = canonicalizeShapes(new Map([['a.tu', a]]))
    expect(r1.descriptors[0]!.hash).toBe(r2.descriptors[0]!.hash)
    expect(r1.descriptors[0]!.canonicalName).toBe(r2.descriptors[0]!.canonicalName)
  })
})
