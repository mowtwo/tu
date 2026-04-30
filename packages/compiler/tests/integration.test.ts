import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { renderToString } from '@tu/runtime'
import { describe, expect, it } from 'vitest'
import { compile } from '../src/index.js'

const here = dirname(fileURLToPath(import.meta.url))

async function compileAndRun<T>(
  source: string,
  call: (mod: Record<string, unknown>) => T
): Promise<T> {
  const js = compile(source)
  const outPath = resolve(here, '.tu-tmp', `out-${process.pid}-${Date.now()}-${Math.random()}.mjs`)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, js)
  try {
    const mod = (await import(pathToFileURL(outPath).href)) as Record<string, unknown>
    return call(mod)
  } finally {
    rmSync(dirname(outPath), { recursive: true, force: true })
  }
}

describe('compile + render end-to-end', () => {
  it('renders the canonical Greeting example', async () => {
    const html = await compileAndRun(
      `
        export let Greeting = (name: string) => {
          div(class: "greet") {
            h1 { "Hello, " name "!" }
            p { "Welcome to Tu" }
          }
        }
      `,
      (mod) => {
        const fn = mod['Greeting'] as (n: string) => unknown
        return renderToString(fn('World') as never)
      }
    )
    expect(html).toBe('<div class="greet"><h1>Hello, World!</h1><p>Welcome to Tu</p></div>')
  })

  it('handles void elements correctly', async () => {
    const html = await compileAndRun(
      `export let Card = () => div { img(src: "/a.png") }`,
      (mod) => {
        const fn = mod['Card'] as () => unknown
        return renderToString(fn() as never)
      }
    )
    expect(html).toBe('<div><img src="/a.png"></div>')
  })

  it('escapes user data in text and attributes', async () => {
    const html = await compileAndRun(
      `export let Risk = (raw: string) => p(title: raw) { raw }`,
      (mod) => {
        const fn = mod['Risk'] as (s: string) => unknown
        return renderToString(fn('<x>"&y') as never)
      }
    )
    // Attributes escape &, ", and < (but not >); text escapes &, <, and >.
    expect(html).toBe('<p title="&lt;x>&quot;&amp;y">&lt;x&gt;"&amp;y</p>')
  })

  interface SignalCell<T> {
    get(): T
    set(v: T): void
  }

  it('top-level let auto-binds to a Signal cell with reactive computed', async () => {
    const result = await compileAndRun(
      `
        export let count = 0
        export let doubled = computed(count * 2)
        export let App = () => p { count }
      `,
      (mod) => {
        const count = mod['count'] as SignalCell<number>
        const doubled = mod['doubled'] as SignalCell<number>
        const App = mod['App'] as () => unknown
        const initial = renderToString(App() as never)
        const initialDoubled = doubled.get()
        count.set(7)
        const afterSet = renderToString(App() as never)
        const afterSetDoubled = doubled.get()
        return { initial, initialDoubled, afterSet, afterSetDoubled }
      }
    )
    expect(result.initial).toBe('<p>0</p>')
    expect(result.initialDoubled).toBe(0)
    expect(result.afterSet).toBe('<p>7</p>')
    expect(result.afterSetDoubled).toBe(14)
  })

  it('binary arithmetic with mixed cell + literal operands', async () => {
    const result = await compileAndRun(
      `
        export let n = 10
        export let derived = computed(n * 2 + 1)
      `,
      (mod) => {
        const n = mod['n'] as SignalCell<number>
        const derived = mod['derived'] as SignalCell<number>
        const before = derived.get()
        n.set(5)
        const after = derived.get()
        return { before, after }
      }
    )
    expect(result.before).toBe(21) // 10*2 + 1
    expect(result.after).toBe(11) //  5*2 + 1
  })

  it('renders a for-loop list reactively as the iter cell mutates', async () => {
    const result = await compileAndRun(
      `
        export let items = 0
        export let List = () => ul {
          for item in items {
            li { item }
          }
        }
      `,
      (mod) => {
        const items = mod['items'] as SignalCell<string[]>
        const List = mod['List'] as () => unknown
        items.set(['a', 'b', 'c'])
        const three = renderToString(List() as never)
        items.set(['x'])
        const one = renderToString(List() as never)
        items.set([])
        const empty = renderToString(List() as never)
        return { three, one, empty }
      }
    )
    expect(result.three).toBe('<ul><li>a</li><li>b</li><li>c</li></ul>')
    expect(result.one).toBe('<ul><li>x</li></ul>')
    expect(result.empty).toBe('<ul></ul>')
  })

  it('renders an if/else branch reactively', async () => {
    const result = await compileAndRun(
      `
        export let count = 0
        export let App = () => div {
          if (count > 0) {
            p { "positive: " count }
          } else {
            p { "non-positive" }
          }
        }
      `,
      (mod) => {
        const count = mod['count'] as SignalCell<number>
        const App = mod['App'] as () => unknown
        const zero = renderToString(App() as never)
        count.set(5)
        const five = renderToString(App() as never)
        return { zero, five }
      }
    )
    expect(result.zero).toBe('<div><p>non-positive</p></div>')
    expect(result.five).toBe('<div><p>positive: 5</p></div>')
  })

  it('renders a chained if/else label reactively (replacement for the removed match form)', async () => {
    const result = await compileAndRun(
      `
        export let n = 0
        export let App = () => p {
          if (n == 0) { "zero" }
          else if (n == 1) { "one" }
          else { "many" }
        }
      `,
      (mod) => {
        const n = mod['n'] as SignalCell<number>
        const App = mod['App'] as () => unknown
        const zero = renderToString(App() as never)
        n.set(1)
        const one = renderToString(App() as never)
        n.set(99)
        const many = renderToString(App() as never)
        return { zero, one, many }
      }
    )
    expect(result.zero).toBe('<p>zero</p>')
    expect(result.one).toBe('<p>one</p>')
    expect(result.many).toBe('<p>many</p>')
  })

  it('renders a component with a style block as a fragment with un-escaped CSS', async () => {
    const html = await compileAndRun(
      `
        export let Card = () => {
          div(class: "card") { h1 { "Hello" } }
          style {
            .card { padding: 1rem; color: #333; }
            .card > h1 { font-weight: 700; }
          }
        }
      `,
      (mod) => {
        const Card = mod['Card'] as () => unknown
        return renderToString(Card() as never)
      }
    )
    expect(html).toContain('<div class="card"><h1>Hello</h1></div>')
    expect(html).toContain('<style>')
    // CSS body must NOT have its `>` escaped; raw-text element passes through.
    expect(html).toContain('.card > h1 { font-weight: 700; }')
    expect(html).not.toContain('&gt;')
  })

  it('renders a scoped component with hashed class names matching the markup', async () => {
    const html = await compileAndRun(
      `
        export let Card = () => {
          .card() { "hi" }
          style { .card { padding: 1rem; } }
        }
      `,
      (mod) => {
        const Card = mod['Card'] as () => unknown
        return renderToString(Card() as never)
      }
    )
    // Markup carries `card card-tu-XXX` (M5/F dual-class injection); the
    // style tag references the hashed name only.
    const classMatch = html.match(/class="card (card-tu-[a-f0-9]{6})"/)!
    const klass = classMatch[1]
    expect(html).toContain(`<div class="card ${klass}">hi</div>`)
    expect(html).toContain(`<style>.${klass} { padding: 1rem; }`)
  })

  it('renders two components with the same class declaration without collision', async () => {
    const html = await compileAndRun(
      `
        export let A = () => {
          div(class: .card) { "A body" }
          style { .card { color: red; } }
        }
        export let B = () => {
          div(class: .card) { "B body" }
          style { .card { color: blue; } }
        }
      `,
      (mod) => {
        const A = mod['A'] as () => unknown
        const B = mod['B'] as () => unknown
        return renderToString(A() as never) + renderToString(B() as never)
      }
    )
    const classes = [...html.matchAll(/class="card (card-tu-[a-f0-9]{6})"/g)].map((m) => m[1])
    expect(classes).toHaveLength(2)
    expect(classes[0]).not.toBe(classes[1])
    // Each component's style block carries its own hashed class:
    expect(html).toContain(`.${classes[0]} { color: red; }`)
    expect(html).toContain(`.${classes[1]} { color: blue; }`)
  })

  it('lambda params shadow same-named top-level cells', async () => {
    const result = await compileAndRun(
      `
        let name = "outer"
        export let G = (name: string) => p { name }
      `,
      (mod) => {
        const G = mod['G'] as (s: string) => unknown
        return renderToString(G('inner') as never)
      }
    )
    expect(result).toBe('<p>inner</p>')
  })
})
