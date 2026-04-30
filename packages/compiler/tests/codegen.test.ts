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
    // Markup gets BOTH the original class name AND the hashed one (M5/F).
    const m = js.match(/"class": "card card-tu-([a-f0-9]{6})"/)
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
    const matches = [...js.matchAll(/card-tu-([a-f0-9]{6})/g)].map((x) => x[1])
    // Markup-side appears twice per component (original + hashed) and CSS
    // side once per component, so dedupe by uniqueness.
    const unique = [...new Set(matches)]
    expect(unique).toHaveLength(2)
    expect(unique[0]).not.toBe(unique[1])
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

  it('M1.13: :global(.foo) opts a selector out of per-component scoping', () => {
    const js = compile(`
      let App = () => {
        div(class: .card) { "hi" }
        style {
          .card { padding: 1rem; }
          :global(.legacy-modal) { z-index: 9999; }
        }
      }
    `)
    const hash = js.match(/-tu-([a-f0-9]{6})/)![1]
    // The scoped selector keeps its hash.
    expect(js).toContain(`.card-tu-${hash} { padding: 1rem; }`)
    // The :global wrapper is stripped; the inner class stays unhashed.
    expect(js).toContain('.legacy-modal { z-index: 9999; }')
    expect(js).not.toContain(':global(')
    expect(js).not.toContain('.legacy-modal-tu-')
  })

  it('M1.13: :global(...) inside a compound selector strips only the wrapper', () => {
    const js = compile(`
      let App = () => {
        div(class: .card) { "hi" }
        style {
          .card { padding: 1rem; }
          .card :global(.icon) { color: red; }
        }
      }
    `)
    const hash = js.match(/-tu-([a-f0-9]{6})/)![1]
    expect(js).toContain(`.card-tu-${hash} .icon { color: red; }`)
    expect(js).not.toContain('.icon-tu-')
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

  it('multi-class pug-shorthand `.foo.bar()` produces a space-joined class binding', () => {
    const js = compile(`
      let App = () => {
        .card.shadow() { "hi" }
        style {
          .card { padding: 1rem; }
          .shadow { box-shadow: 0 1px 4px black; }
        }
      }
    `)
    const hash = js.match(/-tu-([a-f0-9]{6})/)![1]
    // Each ClassRef now emits both the raw name and the hashed one.
    expect(js).toContain(
      `(("card card-tu-${hash}" + " ") + "shadow shadow-tu-${hash}")`
    )
    expect(js).toContain('h("div')
  })

  it('pug-shorthand `tag:` prop overrides the default `div` tag', () => {
    const js = compile(`
      let App = () => {
        .card(tag: "section") { "hi" }
        style { .card { padding: 1rem; } }
      }
    `)
    expect(js).toContain('h("section"')
    expect(js).not.toContain('h("div"')
    expect(js).toMatch(/"class": "card card-tu-[a-f0-9]{6}"/)
    expect(js).not.toContain('"tag": ')
  })

  it('rejects a non-string-literal `tag:` prop in pug shorthand', () => {
    expect(() => compile(`
      let App = () => {
        .card(tag: someExpr) { "hi" }
        style { .card { padding: 1rem; } }
      }
    `)).toThrow(/tag: prop must be a string literal/)
  })

  it('compiles `.foo() { children }` pug-shorthand to a div with the scoped class', () => {
    const js = compile(`
      let App = () => {
        .card() { "hi" }
        style { .card { padding: 1rem; } }
      }
    `)
    const hash = js.match(/-tu-([a-f0-9]{6})/)![1]
    expect(js).toContain(`h("div", { "class": "card card-tu-${hash}" }, ["hi"])`)
  })

  it('M2.3: importedNameKinds={state} causes imported reads to emit `.get()`', () => {
    // Without the option, `count` is treated as a plain function/value and
    // emits as a bare ident — that's the M2.1 reactivity bug.
    const bareJs = compile('import { count } from "./M.tu"\nexport let App = () => p { count }')
    expect(bareJs).toContain('h("p", {}, [count])')

    // With the option, the same imported name is classified as state and
    // reads emit `.get()`, restoring reactivity.
    const fixedJs = compile(
      'import { count } from "./M.tu"\nexport let App = () => p { count }',
      { importedNameKinds: new Map([['count', 'state']]) }
    )
    expect(fixedJs).toContain('h("p", {}, [count.get()])')
  })

  it('M2.3: importedNameKinds={function} keeps the bare-ident behavior (default)', () => {
    const js = compile(
      'import { Card } from "./M.tu"\nexport let App = () => Card("hi")',
      { importedNameKinds: new Map([['Card', 'function']]) }
    )
    expect(js).toContain('Card("hi")')
    expect(js).not.toContain('Card.get()')
  })

  it('M2.5: empty array literal emits as []', () => {
    const js = compile('let xs = []')
    expect(js).toContain('const xs = new Signal.State([])')
  })

  it('M2.5: array literal of mixed primitives + idents', () => {
    const js = compile(`
      let label = "x"
      let xs = [1, 2, label]
    `)
    expect(js).toContain('const xs = new Signal.State([1, 2, label.get()])')
  })

  it('M2.5: array literal as a tag-call child flattens via array-fragment renderer', () => {
    const js = compile(`
      let App = () => ul {
        [li { "a" }, li { "b" }]
      }
    `)
    expect(js).toContain(
      'h("ul", {}, [[h("li", {}, ["a"]), h("li", {}, ["b"])]])'
    )
  })

  it('M5.8: member access injects .get() on the leaf cell ident only', () => {
    const js = compile(`
      let origin = { x: 0, y: 0 }
      let App = () => p { origin.x }
    `)
    // `origin.get().x` — the cell read happens, then the property is accessed
    // on the resolved value. The property name itself stays plain.
    expect(js).toContain('origin.get().x')
  })

  it('M5.8: chained member access compiles to nested dots', () => {
    const js = compile(`
      let nested = { outer: { inner: 1 } }
      let App = () => p { nested.outer.inner }
    `)
    expect(js).toContain('nested.get().outer.inner')
  })

  it('M5.8: member access on a call result skips .get() (call result is not a cell)', () => {
    const js = compile(`
      let make = (n: number) => { x: n }
      let App = () => p { make(7).x }
    `)
    expect(js).toContain('make(7).x')
  })

  it('M5.8: lambda-param object access emits the param ident plain', () => {
    const js = compile('let read = (p) => p.x')
    expect(js).toContain('const read = (p) => p.x')
    expect(js).not.toContain('p.get()')
  })

  it('M5.6: object literal as a let-decl value emits the matching JS object', () => {
    const js = compile('let p = { x: 1, y: 2 }')
    expect(js).toContain('const p = new Signal.State({ x: 1, y: 2 })')
  })

  it('M5.6: empty object literal emits as `{}`', () => {
    const js = compile('let p = {}')
    expect(js).toContain('const p = new Signal.State({})')
  })

  it('M5.6: object literal in a lambda return slot stays unwrapped', () => {
    const js = compile('let make = () => { x: 1, y: 2 }')
    expect(js).toContain('const make = () => ({ x: 1, y: 2 })')
  })

  it('M5.6: object-literal property values get cell `.get()` injection on idents', () => {
    const js = compile(`
      let count = 0
      let snapshot = computed({ now: count })
    `)
    expect(js).toContain('Signal.Computed(() => ({ now: count.get() }))')
  })

  it('M5.6: string keys are emitted quoted', () => {
    const js = compile('let p = { "data-id": 7 }')
    expect(js).toContain('const p = new Signal.State({ "data-id": 7 })')
  })

  it('M5.6: nested object literal round-trips', () => {
    const js = compile('let p = { outer: { inner: 1 } }')
    expect(js).toContain('const p = new Signal.State({ outer: { inner: 1 } })')
  })

  it('M5.6: object literal as positional arg to a function call', () => {
    const js = compile(`
      let make = (opts) => opts
      let p = make({ x: 1 })
    `)
    expect(js).toContain('const p = new Signal.State(make({ x: 1 }))')
  })

  it('M2.5: nested array of class refs round-trips through scoped components', () => {
    const js = compile(`
      let App = () => {
        div(class: .card) { "x" }
        style { .card { padding: 1rem; } }
      }
    `)
    // ClassRef walking through ArrayLit shouldn't have broken the existing
    // scoped emit — just guard against regressions.
    expect(js).toMatch(/-tu-[a-f0-9]{6}/)
  })

  it('M5: capitalized callee compiles as a function call, not h("Tag", …)', () => {
    const js = compile(`
      let Card = (label) => p { label }
      let App = () => Card("hi")
    `)
    expect(js).toContain('const App = () => Card("hi")')
    // Crucially, NOT `h("Card", ...)` — Card is a real function.
    expect(js).not.toContain('h("Card"')
  })

  it('M5: `Card { children }` compiles to Card([children])', () => {
    const js = compile(`
      let Card = (children) => div { children }
      let App = () => Card { p { "body" } }
    `)
    expect(js).toContain('const App = () => Card([h("p", {}, ["body"])])')
  })

  it('M5: `Card("hi") { children }` compiles with args + trailing children', () => {
    const js = compile(`
      let Card = (label, children) => div { label children }
      let App = () => Card("Hello") { p { "body" } }
    `)
    expect(js).toContain('Card("Hello", [h("p", {}, ["body"])])')
  })

  it('M5.2: local `let` inside a block compiles to a const inside an IIFE', () => {
    const js = compile(`
      let App = () => {
        let greeting = "hi"
        p { greeting }
      }
    `)
    expect(js).toContain('const greeting = "hi"')
    expect(js).toContain('return h("p", {}, [greeting])')
  })

  it('M5.2: local `let` chains support multi-step computation', () => {
    const js = compile(`
      let App = () => {
        let a = 1
        let b = a + 2
        p { b }
      }
    `)
    expect(js).toContain('const a = 1')
    expect(js).toContain('const b = (a + 2)')
    expect(js).toContain('return h("p", {}, [b])')
  })

  it('M5.2: local `let` is plain const, NOT wrapped in Signal.State', () => {
    const js = compile(`
      let App = () => {
        let count = 0
        p { count }
      }
    `)
    // Module-level lets wrap; local lets do not.
    expect(js).not.toContain('new Signal.State')
    expect(js).toContain('const count = 0')
    // And reads stay as bare idents (no .get() injection inside the block).
    expect(js).toContain('return h("p", {}, [count])')
  })

  it('M5/D: rejects an element selector at the top of a style block', () => {
    expect(() => compile(`
      let App = () => {
        div(class: .card) { "x" }
        style {
          .card { color: red; }
          p { font-size: 1rem; }
        }
      }
    `)).toThrow(/top-level CSS rule must use a class selector/)
  })

  it('M5/D: nested selectors inside a class are allowed (CSS4 nesting)', () => {
    // `.card { p { … } }` is valid — the nesting is browser-handled.
    expect(() => compile(`
      let App = () => {
        div(class: .card) { p { "hi" } }
        style {
          .card {
            padding: 1rem;
            p { color: red; }
          }
        }
      }
    `)).not.toThrow()
  })

  it('M5/D: :global escape hatch passes top-level validation', () => {
    expect(() => compile(`
      let App = () => {
        div(class: .card) { "x" }
        style {
          :global(.legacy) { z-index: 9999; }
          .card { padding: 1rem; }
        }
      }
    `)).not.toThrow()
  })

  it('M5: lowercase ident in tag-call position remains an HTML tag', () => {
    const js = compile('let App = () => div { "x" }')
    expect(js).toContain('h("div", {}, ["x"])')
    expect(js).not.toContain('div([')
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
