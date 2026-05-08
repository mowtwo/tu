import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { compile, compileToTS, compileToTSWithMap } from '../src/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..')

describe('compileToTS — type-annotation preservation', () => {
  it('keeps lambda parameter `: type` annotations in TS output (vs stripping in JS)', () => {
    const ts = compileToTS('export let G = (name: string) => p { name }')
    expect(ts).toContain('export const G = (name: string) =>')
  })

  it('M9: enum declarations emit a value object plus a like-named value-union type', () => {
    const ts = compileToTS('export enum Tone { Neutral, Accent = "accent" }')
    expect(ts).toContain('export const Tone = Object.freeze({ "Neutral": "Neutral", "Accent": "accent" })')
    expect(ts).toContain('export type Tone = (typeof Tone)[keyof typeof Tone]')
  })

  it('preserves multiple typed params in the same lambda', () => {
    const ts = compileToTS('export let f = (a: number, b: string) => p { a }')
    expect(ts).toContain('export const f = (a: number, b: string) =>')
  })

  it('M9 Phase B: untyped params default to `unknown` in TS shadow (was implicit any)', () => {
    const ts = compileToTS('export let f = (x) => p { x }')
    expect(ts).toContain('export const f = (x: unknown) =>')
  })

  it('M9 Phase D: untyped params infer from the first same-file callsite', () => {
    const ts = compileToTS(`
      let double = (x) => x + 1
      let out = double(41)
    `)
    expect(ts).toContain('const double = (x: number) =>')
  })

  it('M9 Phase D: first-call inference handles object-literal shapes', () => {
    const ts = compileToTS(`
      let label = (card) => card.title
      let out = label({ title: "Tu", count: 1 })
    `)
    expect(ts).toContain('const label = (card: { title: string; count: number }) =>')
  })

  it('M9 Phase D: same-file callsites widen primitive param types', () => {
    const ts = compileToTS(`
      let echo = (x) => x
      let a = echo(1)
      let b = echo("two")
    `)
    expect(ts).toContain('const echo = (x: number | string) =>')
  })

  it('M9 Phase D: same-file callsites widen object-shape param types', () => {
    const ts = compileToTS(`
      let label = (card) => card.title
      let a = label({ title: "Tu" })
      let b = label({ title: 2 })
    `)
    expect(ts).toContain('const label = (card: { title: string } | { title: number }) =>')
  })

  it('M9 Phase D: callsite inference handles arithmetic and comparison args', () => {
    const ts = compileToTS(`
      let show = (n, ok) => [n, ok]
      let out = show(1 + 2, 3 > 1)
    `)
    expect(ts).toContain('const show = (n: number, ok: boolean) =>')
  })

  it('M9 Phase D: array arg inference widens across all elements', () => {
    const ts = compileToTS(`
      let first = (xs) => xs
      let out = first([1, "two"])
    `)
    expect(ts).toContain('const first = (xs: (number | string)[]) =>')
  })

  it('M9 Phase D: callsite inference reads member types from same-file object lets', () => {
    const ts = compileToTS(`
      let user = { profile: { name: "Ada" } }
      let show = (name) => name
      let out = show(user.profile.name)
    `)
    expect(ts).toContain('const show = (name: string) =>')
  })

  it('M9 Phase D: callsite inference reads element types from indexed arrays', () => {
    const ts = compileToTS(`
      let xs = [1, "two"]
      let show = (value) => value
      let out = show(xs[0])
    `)
    expect(ts).toContain('const show = (value: number | string) =>')
  })

  it('M9 Phase D: callsite inference follows typed helper return values', () => {
    const ts = compileToTS(`
      let user = { profile: { name: "Ada" } }
      let getName = (u: { profile: { name: string } }) => u.profile.name
      let name = getName(user)
      let show = (value) => value
      let out = show(name)
    `)
    expect(ts).toContain('const show = (value: string) =>')
  })

  it('M9 Phase D: callsite inference follows explicit helper return annotations', () => {
    const ts = compileToTS(`
      let getName = (): string => "Ada"
      let name = getName()
      let show = (value) => value
      let out = show(name)
    `)
    expect(ts).toContain('const show = (value: string) =>')
  })

  it('M9 Phase D: callsite inference follows inferred identity returns', () => {
    const ts = compileToTS(`
      let id = (x) => x
      let value = id(42)
      let show = (value) => value
      let out = show(value)
    `)
    expect(ts).toContain('const id = (x: number) =>')
    expect(ts).toContain('const show = (value: number) =>')
  })

  it('M9 Phase D: uncalled params infer from first member-use shape', () => {
    const ts = compileToTS(`
      let label = (card) => card.title
    `)
    expect(ts).toContain('const label = (card: { title: unknown }) =>')
  })

  it('M9 Phase D: body-use inference handles nested member chains', () => {
    const ts = compileToTS(`
      let label = (user) => user.profile.name
    `)
    expect(ts).toContain('const label = (user: { profile: { name: unknown } }) =>')
  })

  it('M9 Phase D: body-use inference merges nested sibling fields', () => {
    const ts = compileToTS(`
      let label = (user) => [user.profile.name, user.profile.age]
    `)
    expect(ts).toContain('const label = (user: { profile: { age: unknown; name: unknown } }) =>')
  })

  it('M9 Phase D: uncalled params infer number from arithmetic body use', () => {
    const ts = compileToTS(`
      let double = (x) => x * 2
    `)
    expect(ts).toContain('const double = (x: number) =>')
  })

  it('M9 Phase D: uncalled params infer number from numeric plus body use', () => {
    const ts = compileToTS(`
      let inc = (x) => x + 1
    `)
    expect(ts).toContain('const inc = (x: number) =>')
  })

  it('M9 Phase D: uncalled params infer boolean from unary body use', () => {
    const ts = compileToTS(`
      let toggle = (ok) => !ok
    `)
    expect(ts).toContain('const toggle = (ok: boolean) =>')
  })

  it('M9 Phase D: uncalled params infer arrays from spread body use', () => {
    const ts = compileToTS(`
      let copy = (items) => [...items]
    `)
    expect(ts).toContain('const copy = (items: unknown[]) =>')
  })

  it('M9 Phase D: uncalled params infer from literal comparisons', () => {
    const ts = compileToTS(`
      let matches = (name, age) => [name == "Ada", age > 18]
    `)
    expect(ts).toContain('const matches = (name: string, age: number) =>')
  })

  it('M9 Phase D: callsite inference wins over body-use fallback', () => {
    const ts = compileToTS(`
      let label = (card) => card.title
      let out = label({ title: "Tu" })
    `)
    expect(ts).toContain('const label = (card: { title: string }) =>')
  })

  it('M9 Phase D: explicit param annotations still win over callsite inference', () => {
    const ts = compileToTS(`
      let stringify = (x: string | number) => x
      let out = stringify(42)
    `)
    expect(ts).toContain('const stringify = (x: string | number) =>')
  })

  it('M2.2: state-cell let with `: T` wraps the annotation as Signal.State<T>', () => {
    const ts = compileToTS('export let count: number = 0')
    expect(ts).toContain('export const count: Signal.State<number> = new Signal.State(0)')
  })

  it('M2.2: computed-cell let with `: T` wraps as Signal.Computed<T>', () => {
    const ts = compileToTS(`
      export let count = 0
      export let doubled: number = computed(count * 2)
    `)
    expect(ts).toContain('export const doubled: Signal.Computed<number> = new Signal.Computed')
  })

  it('M2.2: lambda let with `: T` annotates the const directly (no wrap)', () => {
    const ts = compileToTS('export let App: () => string = () => "hi"')
    expect(ts).toContain('export const App: () => string = () =>')
    expect(ts).not.toContain('Signal.State<')
  })

  it('M2.2: type annotation is erased from the JS-mode output', () => {
    // compile() (NOT compileToTS) erases types — JS doesn't get `: number`.
    const js = compile('export let count: number = 0')
    expect(js).toContain('export const count = new Signal.State(0)')
    expect(js).not.toContain(': number')
    expect(js).not.toContain(': Signal.State')
  })

  it('M2.5: empty-array state init widens to `Signal.State<any[]>` to keep .set() open', () => {
    // Pre-fix: `let xs = []` inferred as Signal.State<never[]>; later
    // `xs.set(["a"])` errored with "Type 'string' not assignable to never".
    const ts = compileToTS('export let xs = []')
    expect(ts).toContain('export const xs = new Signal.State<any[]>([])')
  })

  it('M2.5: explicit type annotation overrides the empty-array widening', () => {
    const ts = compileToTS('export let xs: number[] = []')
    // The annotation supplies the type — codegen should NOT also force `any[]`.
    expect(ts).toContain('export const xs: Signal.State<number[]>')
    expect(ts).toContain('new Signal.State([])')
    expect(ts).not.toContain('new Signal.State<any[]>')
  })

  it('M2.4: top-level `type X = …` emits a TS type alias', () => {
    const ts = compileToTS('type Pair = { x: number, y: number }')
    expect(ts).toContain('type Pair = { x: number, y: number }')
    // No JS-side emission for the alias.
    expect(ts).not.toContain('const Pair')
  })

  it('M2.4: `export type X = …` emits an exported alias', () => {
    const ts = compileToTS('export type Color = "red" | "green" | "blue"')
    expect(ts).toContain('export type Color = "red" | "green" | "blue"')
  })

  it('M2.4: type aliases are erased from the JS-mode output', () => {
    const js = compile(`
      type Pair = { x: number, y: number }
      export let origin = 0
    `)
    expect(js).not.toContain('Pair')
    expect(js).not.toContain('type ')
    expect(js).toContain('export const origin = new Signal.State(0)')
  })

  it('M2.4: an annotated let can use a previously-declared type alias', () => {
    const ts = compileToTS(`
      type Counter = Signal.State<number>
      export let count: Counter = 0
    `)
    expect(ts).toContain('type Counter = Signal.State<number>')
    // The annotation goes through verbatim (no extra Signal.State<...> wrap).
    expect(ts).toContain('export const count: Signal.State<Counter>')
  })

  it('M2.4: contextual `type` keyword does not break a value named `type`', () => {
    // `type` as a lambda param name still parses as an identifier, since
    // contextual-keyword detection requires `type Ident =` at top level.
    const ts = compileToTS('export let f = (type: string) => p { type }')
    expect(ts).toContain('export const f = (type: string) =>')
    expect(ts).toContain('h("p", {}, [type])')
  })

  it('M3.9 + M9: synthesizes an all-optional `${Name}Props` interface with children slot', () => {
    const ts = compileToTS(
      'export let Card = (title: string, body: string) => p { title }'
    )
    // M9 update: every prop is `?:` optional and `children?: Child[]` is
    // appended — matches M6.1 named-arg call sites where any prop can be
    // omitted (runtime gets `undefined` for missing keys).
    expect(ts).toContain('export interface CardProps { title?: string; body?: string; children?: Child[] }')
    expect(ts).toContain('export const Card = (title: string, body: string) =>')
  })

  it('M9: param destructuring `({ a, b }: T) =>` emits TS-native pattern verbatim', () => {
    const ts = compileToTS(
      'export interface CardProps { title: string; body: string }\n' +
      'export let Card = ({ title, body }: CardProps) => p { title body }'
    )
    expect(ts).toContain('({ title, body }: CardProps) =>')
    // Auto-Props is suppressed because the user already named the prop
    // shape (CardProps) via the destructure annotation. Only ONE
    // interface CardProps appears (the user's `export interface`); no
    // duplicate auto-emit.
    const matches = ts.match(/interface CardProps/g)
    expect(matches?.length ?? 0).toBe(1)
  })

  it('M9: param destructuring with cell-of-same-name in module scope shadows correctly', () => {
    const ts = compileToTS(
      'export let count = 0\n' +
      'interface CountProps { count: number }\n' +
      'export let Show = ({ count }: CountProps) => p { count }'
    )
    // Inside the lambda, `count` refers to the destructured local — NOT
    // the module cell. The shadow set must include destructure fields.
    expect(ts).toContain('({ count }: CountProps) =>')
    expect(ts).toContain('h("p", {}, [count])')  // bare `count`, no `.get()`
  })

  it('M9: destructured param without `: Type` is rejected with a directive', () => {
    expect(() => compileToTS('export let f = ({ a, b }) => a + b')).toThrowError(
      /destructured params require a type annotation/
    )
  })

  it('M9: local-let destructuring `let { a, b } = obj` emits TS-native pattern', () => {
    const ts = compileToTS(`
      export let f = (obj: { a: number; b: number }) => {
        let { a, b } = obj
        a + b
      }
    `)
    // The destructure pattern emits verbatim — TS infers `a` and `b`
    // from the RHS shape so no annotation is needed.
    expect(ts).toContain('let { a, b } = obj')
    // Body refs `a` and `b` as bare idents (no `.get()` since they're
    // local destructured bindings, not module cells).
    expect(ts).toContain('a + b')
  })

  it('M9: local-let destructure shadows module cell of the same name', () => {
    const ts = compileToTS(`
      export let count = 0
      export let f = (obj: { count: number }) => {
        let { count } = obj
        count
      }
    `)
    // Inside f, `count` refers to the destructured local — NOT the
    // top-level cell. Shadow set must include destructure fields.
    expect(ts).toContain('let { count } = obj')
    // The function body reads `count` directly without `.get()`.
    expect(ts).toMatch(/return.*count.*;/)
  })

  it('M9: auto-Props omits the children slot when the lambda already declares a `children` param', () => {
    const ts = compileToTS(
      'export let Wrap = (title: string, children: string) => div { title children }'
    )
    // The user's own `children: string` wins — we don't append a duplicate.
    expect(ts).toContain('export interface WrapProps { title?: string; children?: string }')
    expect(ts).not.toContain('children?: string; children?: Child[]')
  })

  it('M3.9: skips the interface for non-exported lambdas', () => {
    const ts = compileToTS('let inner = (x: number) => p { x }')
    expect(ts).not.toContain('innerProps')
    expect(ts).toContain('const inner = (x: number) =>')
  })

  it('M3.9: skips the interface for lambdas with any untyped param', () => {
    const ts = compileToTS('export let f = (a: number, b) => p { a }')
    expect(ts).not.toContain('fProps')
  })

  it('M3.9: skips the interface for zero-param lambdas', () => {
    const ts = compileToTS('export let App = () => p { "hi" }')
    expect(ts).not.toContain('AppProps')
  })

  it('M3.9: prop interface is omitted from the JS-mode output', () => {
    const js = compile('export let Card = (title: string) => p { title }')
    expect(js).not.toContain('CardProps')
    expect(js).not.toContain('interface ')
  })

  it('M6.12: scoped class names emit a literal union for TS class props', () => {
    const ts = compileToTS(`
      export let App = (ok: boolean) => {
        div(class: { card: ok, shadow: true }) { ok }
        style { .card { color: red; } .shadow { box-shadow: 0 0 4px; } }
      }
    `)
    expect(ts).toContain('type ClassesOf_App = "card" | "shadow"')
    expect(ts).toContain('"class": __tu_class<ClassesOf_App>({ card: ok, shadow: true })')
  })

  it('M6.12: scoped class literal types are omitted from JS output', () => {
    const js = compile(`
      export let App = (ok: boolean) => {
        div(class: { card: ok }) { ok }
        style { .card { color: red; } }
      }
    `)
    expect(js).not.toContain('ClassesOf_App')
    expect(js).not.toContain('__tu_class')
  })

  it('M3.9: skips auto-Props emit when the user has hand-declared a `${Name}Props` type alias', () => {
    // Otherwise tsserver flags `Duplicate identifier 'BadgeProps'` on the
    // shadow .ts — the hand-written `type BadgeProps = …` collides with
    // the auto-emitted `interface BadgeProps`.
    const ts = compileToTS(
      'export type BadgeProps = { variant?: string }\nexport let Badge = (props: BadgeProps) => span { props.variant }'
    )
    expect(ts).toContain('export type BadgeProps =')
    // The auto-emit would have written `export interface BadgeProps {`.
    expect(ts).not.toContain('export interface BadgeProps')
  })

  it('M5.7: lambda return-type annotation preserved in TS emit', () => {
    const ts = compileToTS('export let f = (x: number): string => "ok"')
    expect(ts).toContain('export const f = (x: number): string => "ok"')
  })

  it('M5.7: lambda return-type erased in JS emit', () => {
    const js = compile('export let f = (x: number): string => "ok"')
    expect(js).toContain('export const f = (x) => "ok"')
    expect(js).not.toContain(': string')
  })

  it('M5.6: object literal preserved verbatim in TS emit', () => {
    const ts = compileToTS('export let p = { x: 1, y: 2 }')
    // M8 Phase 3 wraps untyped object literals in `type.tag(__tu_anon_N, …)`.
    // The literal text itself is still emitted verbatim — the wrapper is
    // additive.
    expect(ts).toMatch(/export const p = new Signal\.State\(type\.tag\(__tu_anon_\d+, \{ x: 1, y: 2 \}\)\)/)
  })

  it('M5.6: typed state-cell with object literal wraps as Signal.State<T>', () => {
    const ts = compileToTS(`
      type Point = { x: number; y: number }
      export let p: Point = { x: 1, y: 2 }
    `)
    expect(ts).toContain('export const p: Signal.State<Point> = new Signal.State({ x: 1, y: 2 })')
  })

  it('still threads source maps through the TS output', () => {
    const { code, map } = compileToTSWithMap(
      'export let G = (name: string) => p { name }',
      { filename: 'g.tu' }
    )
    expect(code).toContain('//# sourceMappingURL=data:application/json;charset=utf-8;base64,')
    expect(map.version).toBe(3)
    expect(map.file).toBe('g.tu')
    expect(map.sources).toEqual(['g.tu'])
  })
})

// Integration: shell out to `tsc --noEmit` over the emitted TS to verify the
// shape is something tsserver actually accepts. Skipped automatically if the
// `typescript` package isn't installed in the worker — the unit tests above
// cover the API contract; this guards the interop story.
const tscBin = resolve(repoRoot, 'node_modules', '.bin', 'tsc')
const tscAvailable = existsSync(tscBin)

describe.skipIf(!tscAvailable)('tsc accepts compileToTS output (M2 type erasure round-trip)', () => {
  let tmp: string
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tu-ts-emit-'))
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  function check(source: string): void {
    const ts = compileToTS(source)
    const tsPath = join(tmp, 'Out.ts')
    writeFileSync(tsPath, ts)
    // Minimal tsconfig — strict, modern target. Use repo node_modules so the
    // @tu-lang/runtime types resolve correctly.
    const tsconfigPath = join(tmp, 'tsconfig.json')
    writeFileSync(
      tsconfigPath,
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          paths: {
            '@tu-lang/runtime': [resolve(repoRoot, 'packages/runtime/dist/index.d.ts')],
            '@tu-lang/std': [resolve(repoRoot, 'packages/std/dist/index.d.ts')],
          },
        },
        include: ['Out.ts'],
      })
    )
    // tsc throws on type errors; the assertion is "this didn't throw."
    execFileSync(tscBin, ['--project', tsconfigPath], {
      cwd: tmp,
      stdio: 'pipe',
    })
  }

  it('typechecks a static greeting component', () => {
    check('export let Greeting = (name: string) => h1 { "Hello, " name }')
  })

  it('typechecks a state cell + computed cell + component reading both', () => {
    check(`
      export let count = 0
      export let doubled = computed(count * 2)
      export let App = () => p { "count = " count " doubled = " doubled }
    `)
  })

  it('M5.6: typechecks a typed object literal driven by a type alias', () => {
    check(`
      type Point = { x: number; y: number }
      export let origin: Point = { x: 0, y: 0 }
      export let make = (n: number) => { x: n, y: n }
    `)
  })

  it('M5.7: typechecks a lambda return-type annotation against an alias', () => {
    check(`
      type Point = { x: number; y: number }
      export let make = (n: number): Point => { x: n, y: n }
    `)
  })

  it('typechecks an event-handler-driven component (M1.5 path)', () => {
    check(`
      export let count = 0
      let inc = () => count = count + 1
      export let App = () => button(onClick: inc) { "+ " count }
    `)
  })

  it('M6.12: typechecks scoped class object props against declared class keys', () => {
    check(`
      export let App = (ok: boolean) => {
        div(class: { card: ok }) { "ok" }
        style { .card { color: red; } }
      }
    `)
  })

  it('M9: typechecks boolean children', () => {
    check(`
      export let App = (ok: boolean) => p { "ok = " ok }
    `)
  })

  it('M8: typechecks `interface User { … }` + typed `let alice: User = {…}` end-to-end', () => {
    check(`
      interface User { id: number; name: string }
      let alice: User = { id: 1, name: "Alice" }
      export let App = () => p { alice.name }
    `)
  })

  it('M9: narrows top-level cell reads after a null guard', () => {
    check(`
      interface User { id: number; name: string }
      let bob: User | null = { id: 1, name: "Bob" }
      export let App = () => if (bob != null) {
        div {
          p { bob.id }
          p { bob.name }
        }
      }
    `)
  })

  it('M8 + M9: typechecks `type.as(value, User)` against a user-declared interface', () => {
    // The contextual annotation `let alice: Signal.State<User>` (auto-
    // wrapped from `let alice: User = …`) should make TS infer the
    // generic `T = User` for `type.as<T>(value, descriptor): T`. This
    // verifies the M8 type-metadata system flows end-to-end with the
    // M9 runtime-cast helper.
    check(`
      interface User { id: number; name: string }
      let raw: unknown = { id: 1, name: "Alice" }
      let alice: User = type.as(raw, User)
      export let App = () => p { alice.name }
    `)
  })

  it('M9: typechecks enum values in annotations and member reads', () => {
    check(`
      export enum Tone { Neutral, Accent = "accent" }
      export let Badge = (tone: Tone) => p { tone }
      export let App = () => Badge(Tone.Accent)
    `)
  })

  it('M9: typechecks module-scope destructuring as state-cell bindings', () => {
    check(`
      let source = { a: 1, b: "two" }
      let { a, b } = source
      export let App = () => p { a b }
    `)
  })
})
