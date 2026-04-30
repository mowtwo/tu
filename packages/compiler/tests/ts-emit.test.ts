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

  it('preserves multiple typed params in the same lambda', () => {
    const ts = compileToTS('export let f = (a: number, b: string) => p { a }')
    expect(ts).toContain('export const f = (a: number, b: string) =>')
  })

  it('emits names alone for params with no `: type` annotation', () => {
    const ts = compileToTS('export let f = (x) => p { x }')
    expect(ts).toContain('export const f = (x) =>')
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

  it('M3.9: synthesizes a `${Name}Props` interface for exported typed-param lambdas', () => {
    const ts = compileToTS(
      'export let Card = (title: string, body: string) => p { title }'
    )
    expect(ts).toContain('export interface CardProps { title: string; body: string }')
    expect(ts).toContain('export const Card = (title: string, body: string) =>')
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
    expect(ts).toContain('export const p = new Signal.State({ x: 1, y: 2 })')
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
    // @tu-ui/runtime types resolve correctly.
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
            '@tu-ui/runtime': [resolve(repoRoot, 'packages/runtime/dist/index.d.ts')],
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
})
