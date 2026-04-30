import { describe, expect, it } from 'vitest'
import { compile } from '../src/index.js'

describe('codegen', () => {
  it('emits a runtime import header bringing in h and Signal', () => {
    expect(compile('')).toContain(`import { h, Signal } from '@tu/runtime'`)
  })

  it('wraps a top-level let with a primitive value as a Signal.State cell', () => {
    const js = compile('let greeting = "hi"')
    expect(js).toContain(`export const greeting = new Signal.State("hi")`)
  })

  it('wraps a top-level numeric let as Signal.State', () => {
    const js = compile('let count = 0')
    expect(js).toContain(`export const count = new Signal.State(0)`)
  })

  it('emits a Signal.Computed cell for `let X = computed(expr)`', () => {
    const js = compile(`
      let count = 0
      let doubled = computed(count * 2)
    `)
    expect(js).toContain(`export const doubled = new Signal.Computed(() => (count.get() * 2))`)
  })

  it('emits a top-level let bound to a lambda as a plain const (no signal wrap)', () => {
    const js = compile('let App = () => div { "Hi" }')
    expect(js).toContain(`export const App = () => h("div", {}, ["Hi"])`)
    expect(js).not.toContain(`new Signal.State(`)
  })

  it('treats lambda params as plain identifiers, not cells', () => {
    const js = compile('let G = (name: string) => div { name }')
    expect(js).toContain(`export const G = (name) => h("div", {}, [name])`)
  })

  it('emits .get() when a top-level cell is read inside a lambda body', () => {
    const js = compile(`
      let count = 0
      let Counter = () => p { count }
    `)
    expect(js).toContain(`export const count = new Signal.State(0)`)
    expect(js).toContain(`export const Counter = () => h("p", {}, [count.get()])`)
  })

  it('shadows a top-level cell when a lambda param has the same name', () => {
    const js = compile(`
      let name = "outer"
      let G = (name: string) => p { name }
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
      let App = () => {
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
      let App = () => {
        div(class: "card") { "hi" }
        style { .card { padding: 1rem; } }
      }
    `)
    expect(js).toContain('export const App = () => [h("div", { "class": "card" }, ["hi"]), h("style", {}, [".card { padding: 1rem; }')
  })

  it('compiles the canonical greeting example', () => {
    const js = compile(`
      let Greeting = (name: string) => {
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
})
