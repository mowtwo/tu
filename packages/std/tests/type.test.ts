import { describe, expect, it } from 'vitest'
import { is, of, struct, tag, type } from '../src/index.js'

describe('@tu-lang/std/type — primitives', () => {
  it('of() classifies JS primitive values', () => {
    expect(of(1)).toBe(type.Number)
    expect(of(0)).toBe(type.Number)
    expect(of(NaN)).toBe(type.Number)
    expect(of('hi')).toBe(type.String)
    expect(of('')).toBe(type.String)
    expect(of(true)).toBe(type.Boolean)
    expect(of(false)).toBe(type.Boolean)
    expect(of(null)).toBe(type.Null)
    expect(of(undefined)).toBe(type.Null)
    expect(of(() => 0)).toBe(type.Function)
    expect(of(123n)).toBe(type.BigInt)
    expect(of(Symbol('x'))).toBe(type.Symbol)
  })

  it('is() with primitives — exact + mismatch', () => {
    expect(is(1, type.Number)).toBe(true)
    expect(is('1', type.Number)).toBe(false)
    expect(is('', type.String)).toBe(true)
    expect(is(false, type.Boolean)).toBe(true)
    expect(is(0, type.Boolean)).toBe(false)
    expect(is(null, type.Null)).toBe(true)
    expect(is(undefined, type.Null)).toBe(true)
    expect(is(0, type.Null)).toBe(false)
    expect(is(() => 0, type.Function)).toBe(true)
  })

  it('Optional accepts null and the inner type', () => {
    const T = type.Optional(type.Number)
    expect(is(null, T)).toBe(true)
    expect(is(undefined, T)).toBe(true)
    expect(is(42, T)).toBe(true)
    expect(is('42', T)).toBe(false)
  })
})

describe('@tu-lang/std/type — arrays', () => {
  it('of([]) is Array(Object) — empty arrays are heterogeneous', () => {
    const t = of([])
    expect(t.kind).toBe('array')
    expect(t.element).toBe(type.Object)
  })

  it('of([1,2,3]) samples the element type', () => {
    expect(of([1, 2, 3])).toBe(type.Array(type.Number))
  })

  it('Array(T) memoizes — same T returns the same descriptor', () => {
    expect(type.Array(type.Number)).toBe(type.Array(type.Number))
    expect(type.Array(type.String)).toBe(type.Array(type.String))
    expect(type.Array(type.Number)).not.toBe(type.Array(type.String))
  })

  it('is() walks array elements recursively', () => {
    expect(is([1, 2, 3], type.Array(type.Number))).toBe(true)
    expect(is([1, '2', 3], type.Array(type.Number))).toBe(false)
    expect(is([], type.Array(type.Number))).toBe(true)
    expect(is({}, type.Array(type.Number))).toBe(false)
  })
})

describe('@tu-lang/std/type — interface (struct) descriptors', () => {
  it('struct() builds a descriptor; is() does strict-duck-typing', () => {
    const User = struct('User', [
      { name: 'id', type: type.Number },
      { name: 'name', type: type.String },
    ])
    expect(is({ id: 1, name: 'alice' }, User)).toBe(true)
    expect(is({ id: 1 }, User)).toBe(false) // missing name
    expect(is({ id: '1', name: 'alice' }, User)).toBe(false) // wrong type
    expect(is({ id: 1, name: 'alice', extra: true }, User)).toBe(true) // excess OK
    expect(is(null, User)).toBe(false)
    expect(is([], User)).toBe(false)
  })

  it('struct fields can be optional', () => {
    const Profile = struct('Profile', [
      { name: 'id', type: type.Number },
      { name: 'bio', type: type.String, optional: true },
    ])
    expect(is({ id: 1 }, Profile)).toBe(true)
    expect(is({ id: 1, bio: 'hi' }, Profile)).toBe(true)
    expect(is({ id: 1, bio: null }, Profile)).toBe(true)
    expect(is({ id: 1, bio: 42 }, Profile)).toBe(false)
  })

  it('nested structs validate recursively', () => {
    const Inner = struct('Inner', [{ name: 'x', type: type.Number }])
    const Outer = struct('Outer', [
      { name: 'tag', type: type.String },
      { name: 'inner', type: Inner },
    ])
    expect(is({ tag: 'a', inner: { x: 1 } }, Outer)).toBe(true)
    expect(is({ tag: 'a', inner: { x: '1' } }, Outer)).toBe(false)
    expect(is({ tag: 'a', inner: {} }, Outer)).toBe(false)
    expect(is({ tag: 'a' }, Outer)).toBe(false)
  })

  it('array-of-struct validates each element', () => {
    const User = struct('User', [
      { name: 'id', type: type.Number },
      { name: 'name', type: type.String },
    ])
    const arrT = type.Array(User)
    expect(is([{ id: 1, name: 'a' }, { id: 2, name: 'b' }], arrT)).toBe(true)
    expect(is([{ id: 1, name: 'a' }, { id: 2 }], arrT)).toBe(false)
  })
})

describe('@tu-lang/std/type — anonymous shape recovery via of()', () => {
  it('of() on an untagged object synthesizes an anonymous struct', () => {
    const t = of({ x: 1, y: 'hi' })
    expect(t.kind).toBe('struct')
    expect(t.name).toBe('__anon')
    expect(t.fields).toHaveLength(2)
    expect(t.fields![0]?.name).toBe('x')
    expect(t.fields![0]?.type).toBe(type.Number)
    expect(t.fields![1]?.name).toBe('y')
    expect(t.fields![1]?.type).toBe(type.String)
  })

  it('of() on a tagged object recovers the original interface', () => {
    const User = struct('User', [
      { name: 'id', type: type.Number },
      { name: 'name', type: type.String },
    ])
    const alice = tag(User, { id: 1, name: 'Alice' })
    expect(of(alice)).toBe(User)
  })

  it('tag() returns the value unchanged (no enumerable property added)', () => {
    const T = struct('Foo', [{ name: 'x', type: type.Number }])
    const obj = { x: 1 }
    const tagged = tag(T, obj)
    expect(tagged).toBe(obj)
    expect(Object.keys(tagged)).toEqual(['x']) // no marker leaked
  })
})

describe('@tu-lang/std/type — JS-native built-ins', () => {
  it('Promise / Map / Set / Error descriptors via instanceof check', () => {
    expect(is(Promise.resolve(1), type.Promise)).toBe(true)
    expect(is(new Map(), type.Map)).toBe(true)
    expect(is(new Set(), type.Set)).toBe(true)
    expect(is(new Error('x'), type.Error)).toBe(true)
    expect(is(/foo/, type.RegExp)).toBe(true)

    expect(is({}, type.Promise)).toBe(false)
    expect(is([], type.Map)).toBe(false)
  })

  it('Date descriptor (kept for legacy-JS interop; @tu-lang/time wraps Temporal)', () => {
    expect(is(new Date(), type.Date)).toBe(true)
    expect(is(0, type.Date)).toBe(false)
  })
})

describe('@tu-lang/std/type — type.as (M9 Phase C strict-cast)', () => {
  it('2-arg form: returns the value when shape matches', () => {
    const User = struct('User', [
      { name: 'id', type: type.Number },
      { name: 'name', type: type.String },
    ])
    const v = { id: 1, name: 'Alice' }
    expect(type.as(v, User)).toBe(v)
  })

  it('2-arg form: throws TypeMismatchError on shape mismatch', async () => {
    const { TypeMismatchError } = await import('../src/index.js')
    const User = struct('User', [{ name: 'id', type: type.Number }])
    expect(() => type.as({ id: 'not a number' }, User)).toThrow(TypeMismatchError)
    expect(() => type.as({ id: 'not a number' }, User)).toThrow(/expected User/i)
  })

  it('3-arg form: castFn runs first, then the shape check', () => {
    // parseInt the string then check it's a number.
    const n = type.as<number>('42', type.Number, (v) => parseInt(String(v), 10))
    expect(n).toBe(42)
  })

  it('3-arg form: castFn output failing the shape still throws', async () => {
    const { TypeMismatchError } = await import('../src/index.js')
    // parseInt('abc') is NaN — typeof NaN === 'number' so type.Number
    // doesn't reject it. Use a string-target descriptor for a clean
    // numeric-rejection test.
    expect(() =>
      type.as('not-a-number', type.String, (v) => Number(v))
    ).toThrow(TypeMismatchError)
  })

  it('works with primitive descriptors', async () => {
    const { TypeMismatchError } = await import('../src/index.js')
    expect(type.as<string>('hi', type.String)).toBe('hi')
    expect(type.as<number>(42, type.Number)).toBe(42)
    expect(() => type.as(42, type.String)).toThrow(TypeMismatchError)
  })

  it('TypeMismatchError carries expected + actual for typed catches', () => {
    try {
      type.as(42, type.String)
      throw new Error('should have thrown')
    } catch (e) {
      // The error is a TypeMismatchError instance.
      const err = e as { name: string; expected: { name: string }; actual: unknown }
      expect(err.name).toBe('TypeMismatchError')
      expect(err.expected.name).toBe('string')
      expect(err.actual).toBe(42)
    }
  })

  it('preserves the input value (no defensive copy)', () => {
    const User = struct('User', [{ name: 'id', type: type.Number }])
    const v = { id: 1 }
    expect(type.as(v, User)).toBe(v) // same reference
  })
})

describe('@tu-lang/std/type — Any / Never edges', () => {
  it('Any matches anything', () => {
    expect(is(0, type.Any)).toBe(true)
    expect(is(null, type.Any)).toBe(true)
    expect(is({}, type.Any)).toBe(true)
    expect(is([], type.Any)).toBe(true)
  })

  it('Never matches nothing', () => {
    expect(is(0, type.Never)).toBe(false)
    expect(is({}, type.Never)).toBe(false)
    expect(is(null, type.Never)).toBe(false)
  })
})
