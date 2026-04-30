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
    // @tu/runtime types resolve correctly.
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
            '@tu/runtime': [resolve(repoRoot, 'packages/runtime/dist/index.d.ts')],
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

  it('typechecks an event-handler-driven component (M1.5 path)', () => {
    check(`
      export let count = 0
      let inc = () => count = count + 1
      export let App = () => button(onClick: inc) { "+ " count }
    `)
  })
})
