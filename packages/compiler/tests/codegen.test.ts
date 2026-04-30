import { describe, expect, it } from 'vitest'
import { compile } from '../src/index.js'

describe('codegen', () => {
  it('emits a runtime import header bringing in h and Signal', () => {
    expect(compile('')).toContain(`import { h, Signal } from '@tu/runtime'`)
  })

  it('wraps a top-level let with a primitive value as a Signal.State cell', () => {
    const js = compile('export let greeting = "hi"')
    expect(js).toContain(`export const greeting = new Signal.State("hi")`)
  })

  it('wraps a top-level numeric let as Signal.State', () => {
    const js = compile('export let count = 0')
    expect(js).toContain(`export const count = new Signal.State(0)`)
  })

  it('emits a Signal.Computed cell for `let X = computed(expr)`', () => {
    const js = compile(`
      let count = 0
      export let doubled = computed(count * 2)
    `)
    expect(js).toContain(`export const doubled = new Signal.Computed(() => (count.get() * 2))`)
  })

  it('emits a top-level let bound to a lambda as a plain const (no signal wrap)', () => {
    const js = compile('export let App = () => div { "Hi" }')
    expect(js).toContain(`export const App = () => h("div", {}, ["Hi"])`)
    expect(js).not.toContain(`new Signal.State(`)
  })

  it('treats lambda params as plain identifiers, not cells', () => {
    const js = compile('export let G = (name: string) => div { name }')
    expect(js).toContain(`export const G = (name) => h("div", {}, [name])`)
  })

  it('emits .get() when a top-level cell is read inside a lambda body', () => {
    const js = compile(`
      export let count = 0
      export let Counter = () => p { count }
    `)
    expect(js).toContain(`export const count = new Signal.State(0)`)
    expect(js).toContain(`export const Counter = () => h("p", {}, [count.get()])`)
  })

  it('shadows a top-level cell when a lambda param has the same name', () => {
    const js = compile(`
      let name = "outer"
      export let G = (name: string) => p { name }
    `)
    // Inside the lambda, `name` refers to the param — emit as-is.
    expect(js).toContain(`export const G = (name) => h("p", {}, [name])`)
  })

  it('emits props with quoted keys', () => {
    const js = compile('let App = () => div(class: "g") { "x" }')
    expect(js).toContain(`h("div", { "class": "g" }, ["x"])`)
  })

  it('emits binary arithmetic with parens for clarity', () => {
    const js = compile(`
      let a = 1
      let App = () => p { a + 2 * 3 }
    `)
    // Pratt parser respects precedence: 2 * 3 binds tighter than a + ...
    expect(js).toContain(`(a.get() + (2 * 3))`)
  })

  it('flattens block-bodied lambdas to expression form when single child', () => {
    const js = compile(`
      export let App = () => {
        div { "hi" }
      }
    `)
    expect(js).toContain(`export const App = () => (h("div", {}, ["hi"]))`)
  })

  it('emits an if expression as a ternary', () => {
    const js = compile('let x = if (1) { 2 } else { 3 }')
    expect(js).toContain('(1 ? (2) : (3))')
  })

  it('emits if without else as ternary with undefined fallthrough', () => {
    const js = compile('let x = if (1) { 2 }')
    expect(js).toContain('(1 ? (2) : undefined)')
  })

  it('emits a for expression as Array.from with shadowed binder', () => {
    const js = compile(`
      let items = 0
      let App = () => ul {
        for item in items {
          li { item }
        }
      }
    `)
    // `items` is a top-level cell so reads .get(); `item` is the loop binder, not a cell.
    expect(js).toContain('Array.from(items.get(), (item) => (h("li", {}, [item])))')
  })

  it('emits a match expression as IIFE with strict-equality ternary chain', () => {
    const js = compile(`
      let n = 0
      let label = computed(match (n) {
        0 => "zero"
        1 => "one"
        _ => "other"
      })
    `)
    expect(js).toContain('((__m) => __m === 0 ? "zero" : __m === 1 ? "one" : "other")(n.get())')
  })

  it('emits === / !== for Tu == / !=', () => {
    const js = compile(`
      let a = 1
      let eq = computed(a == 1)
      let ne = computed(a != 2)
    `)
    expect(js).toContain('(a.get() === 1)')
    expect(js).toContain('(a.get() !== 2)')
  })

  it('emits a StyleBlock as h("style", {}, [<css>])', () => {
    const js = compile('let X = style { .card { color: red; } }')
    expect(js).toContain('h("style", {}, [".card { color: red; } "])')
  })

  it('emits a fragment array when a Block contains both a tag-call and a style block', () => {
    const js = compile(`
      export let App = () => {
        div(class: "card") { "hi" }
        style { .card { padding: 1rem; } }
      }
    `)
    expect(js).toContain('export const App = () => [h("div", { "class": "card" }, ["hi"]), h("style", {}, [".card { padding: 1rem; }')
  })

  it('emits an assignment to a state cell as cell.set(rhs)', () => {
    const js = compile(`
      let count = 0
      export let inc = () => count = count + 1
    `)
    expect(js).toContain('export const inc = () => count.set((count.get() + 1))')
  })

  it('throws on assignment to a computed cell', () => {
    expect(() => compile(`
      let count = 0
      let doubled = computed(count * 2)
      let bad = () => doubled = 99
    `)).toThrow(/cannot assign to computed cell 'doubled'/)
  })

  it('emits a lambda-valued prop as a JS arrow function (event handler)', () => {
    const js = compile(`
      let count = 0
      export let App = () => button(onClick: () => count = count + 1) { "+" }
    `)
    expect(js).toContain('h("button", { "onClick": () => count.set((count.get() + 1)) }, ["+"])')
  })

  it('does not turn a lambda parameter assignment into .set()', () => {
    // Inside the lambda body, `n` is a param — assignment must stay plain JS.
    const js = compile('export let f = (n: number) => n = n + 1')
    expect(js).toContain('export const f = (n) => (n = (n + 1))')
  })

  it('hashes class refs and CSS selectors with the same suffix in a scoped component', () => {
    const js = compile(`
      let Card = () => {
        div(class: .card) { "x" }
        style { .card { padding: 1rem; } }
      }
    `)
    // Pull the hash out of the markup; the style block must use the same one.
    const m = js.match(/"class": "card-tu-([a-f0-9]{6})"/)
    expect(m).not.toBeNull()
    const hash = m![1]
    expect(js).toContain(`.card-tu-${hash} { padding: 1rem; }`)
  })

  it('uses different hashes for two components declaring the same class', () => {
    const js = compile(`
      let A = () => {
        div(class: .card) { "a" }
        style { .card { color: red; } }
      }
      let B = () => {
        div(class: .card) { "b" }
        style { .card { color: blue; } }
      }
    `)
    const matches = [...js.matchAll(/"card-tu-([a-f0-9]{6})"/g)].map((x) => x[1])
    expect(matches).toHaveLength(2)
    expect(matches[0]).not.toBe(matches[1])
  })

  it('leaves M1.4-style components without ClassRef unchanged (back-compat)', () => {
    const js = compile(`
      let Old = () => {
        div(class: "card") { "x" }
        style { .card { padding: 1rem; } }
      }
    `)
    expect(js).toContain('"class": "card"')
    expect(js).toContain('.card { padding: 1rem; }')
    expect(js).not.toMatch(/-tu-[a-f0-9]/)
  })

  it('leaves classes appearing only inside CSS strings/comments alone', () => {
    const js = compile(`
      let X = () => {
        div(class: .real) { "x" }
        style {
          .real { content: ".not-a-class"; /* .also-not */ color: red; }
        }
      }
    `)
    const hashMatch = js.match(/-tu-([a-f0-9]{6})/)!
    const hash = hashMatch[1]
    expect(js).toContain(`.real-tu-${hash}`)
    expect(js).not.toContain(`.not-a-class-tu-`)
    expect(js).not.toContain(`.also-not-tu-`)
    // The string + comment text survives intact.
    expect(js).toContain('.not-a-class')
    expect(js).toContain('.also-not')
  })

  it('leaves CSS classes that are NOT declared in the same component alone (treated as global)', () => {
    const js = compile(`
      let App = () => {
        div(class: .card) { "x" }
        style {
          .card .legacy-global { color: red; }
        }
      }
    `)
    const hash = js.match(/-tu-([a-f0-9]{6})/)![1]
    expect(js).toContain(`.card-tu-${hash} .legacy-global`)
  })

  it('throws on a class ref to a class not declared in this component', () => {
    expect(() => compile(`
      let X = () => {
        div(class: .ghost) { "x" }
        style { .real { color: red; } }
      }
    `)).toThrow(/class ref \.ghost is not declared/)
  })

  it('throws on a class ref outside any scoped component', () => {
    expect(() => compile(`
      let bad = .card
    `)).toThrow(/class ref \.card used outside a scoped component/)
  })

  it('compiles `.foo() { children }` pug-shorthand to a div with the scoped class', () => {
    const js = compile(`
      let App = () => {
        .card() { "hi" }
        style { .card { padding: 1rem; } }
      }
    `)
    const hash = js.match(/-tu-([a-f0-9]{6})/)![1]
    expect(js).toContain(`h("div", { "class": "card-tu-${hash}" }, ["hi"])`)
  })

  it('compiles the canonical greeting example', () => {
    const js = compile(`
      export let Greeting = (name: string) => {
        div(class: "greet") {
          h1 { "Hello, " name "!" }
          p { "Welcome to Tu" }
        }
      }
    `)
    expect(js).toContain(`export const Greeting = (name) => (h(`)
    expect(js).toContain(`h("h1", {}, ["Hello, ", name, "!"])`)
    expect(js).toContain(`h("p", {}, ["Welcome to Tu"])`)
  })

  // M1.10 visibility — bare `let` is module-private; `export let` is public.

  it('M1.10: bare `let` emits `const` (module-private), no leading export', () => {
    const js = compile('let x = 1')
    expect(js).toContain('const x = new Signal.State(1)')
    expect(js).not.toContain('export const x')
  })

  it('M1.10: `export let` emits `export const`', () => {
    const js = compile('export let x = 1')
    expect(js).toContain('export const x = new Signal.State(1)')
  })

  it('M1.10: a private state cell still wraps in Signal.State and is callable from a same-module lambda', () => {
    const js = compile(`
      let count = 0
      export let App = () => p { count }
    `)
    expect(js).toContain('const count = new Signal.State(0)')
    expect(js).not.toContain('export const count')
    // The exported lambda still reads it via .get().
    expect(js).toContain('export const App = () => h("p", {}, [count.get()])')
  })

  it('M1.10: a private function (lambda) is callable from a same-module exported component', () => {
    const js = compile(`
      let helper = (x: number) => x + 1
      export let App = () => p { helper(2) }
    `)
    expect(js).toContain('const helper = (x) => (x + 1)')
    expect(js).not.toContain('export const helper')
    expect(js).toContain('export const App = () => h("p", {}, [helper(2)])')
  })
})
