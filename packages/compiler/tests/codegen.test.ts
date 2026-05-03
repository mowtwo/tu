import { describe, expect, it } from 'vitest'
import { compile, compileToTS } from '../src/index.js'

describe('codegen', () => {
  it('emits a runtime import header bringing in h and Signal', () => {
    expect(compile('')).toContain(`import { h, Signal } from '@tu-lang/runtime'`)
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

  it('emits ||, &&, ?? logical/nullish operators verbatim', () => {
    const js = compile('let App = (p) => div { p.show && (p.label || p.fallback) ?? "x" }')
    expect(js).toContain('((p.show && (p.label || p.fallback)) ?? "x")')
  })

  it('emits prefix ! / - / + as parenthesized unary', () => {
    const js = compile('let App = (p) => div { !p.hidden + -p.n + +p.m }')
    expect(js).toContain('(!p.hidden)')
    expect(js).toContain('(-p.n)')
    expect(js).toContain('(+p.m)')
  })

  it('erases postfix ! (TS non-null) in JS-emit, preserves in TS-emit', () => {
    expect(compile('let App = (p) => div { p.value! }')).toContain('[p.value]')
    expect(compileToTS('let App = (p) => div { p.value! }')).toContain('[p.value!]')
  })

  it('emits ?.member, ?.(), ?.[] optional-chaining operators', () => {
    const js = compile(`
      let App = (p) => div(onClick: () => p.onClose?.()) {
        p.list?.length
        p.list?.[0]
      }
    `)
    expect(js).toContain('p.onClose?.()')
    expect(js).toContain('p.list?.length')
    expect(js).toContain('p.list?.[0]')
  })

  it('emits computed member access obj[expr]', () => {
    const js = compile('let App = (p) => div { p["key"] }')
    expect(js).toContain('p["key"]')
  })

  it('parenthesized expression overrides operator precedence', () => {
    const js = compile('let App = (p) => div { (p.a || p.b) && p.c }')
    expect(js).toContain('((p.a || p.b) && p.c)')
  })

  it('TS-style optional param `name?: T` lowers to `(T) | undefined` in TS-emit', () => {
    const ts = compileToTS('export let f = (x: string, y?: boolean) => true')
    expect(ts).toContain('y: (boolean) | undefined')
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

  it('M5.9: method call on a lambda param compiles to a plain JS method call', () => {
    const js = compile('let App = () => button(onClick: (e) => e.preventDefault()) { "x" }')
    expect(js).toContain('e.preventDefault()')
  })

  it('M5.9: method call on a state cell injects .get() on the leaf', () => {
    const js = compile(`
      let xs = [1, 2]
      let App = () => p { xs.map((x) => x) }
    `)
    expect(js).toContain('xs.get().map(')
  })

  it('M5.9: chained .method().prop works', () => {
    const js = compile(`
      let obj = {}
      let App = () => p { obj.toString().length }
    `)
    expect(js).toContain('obj.get().toString().length')
  })

  it('M5.8: lambda-param object access emits the param ident plain', () => {
    const js = compile('let read = (p) => p.x')
    expect(js).toContain('const read = (p) => p.x')
    expect(js).not.toContain('p.get()')
  })

  it('M6.0: pure-static subtree (≥3 nodes) collapses to h("$static", …)', () => {
    const js = compile(`
      let App = () => header(class: "hero") {
        h1 { "Tu" }
        p { "A reactive UI language" }
      }
    `)
    expect(js).toContain('h("$static", {}, [],')
    // The static html is stored as a JSON-escaped JS string literal — check
    // the inner shape rather than the surrounding quotes.
    expect(js).toContain('<h1>Tu</h1>')
    expect(js).toContain('<p>A reactive UI language</p>')
    // The optimization should drop the inner h() calls entirely.
    expect(js).not.toMatch(/h\("h1",/)
    expect(js).not.toMatch(/h\("p",/)
  })

  it('M6.0: subtree with a cell read does NOT collapse (dynamic disqualifies)', () => {
    const js = compile(`
      let count = 0
      let App = () => header(class: "hero") {
        h1 { "Tu" }
        p { "count = " count }
      }
    `)
    expect(js).not.toContain('"$static"')
    expect(js).toContain('count.get()')
  })

  it('M6.0: subtree with an event handler does NOT collapse', () => {
    const js = compile(`
      let count = 0
      let App = () => header(class: "hero") {
        button(onClick: () => count = count + 1) { "+1" }
        p { "click" }
      }
    `)
    expect(js).not.toContain('"$static"')
  })

  it('M6.0: tiny subtrees (< 3 nodes) skip the optimization', () => {
    const js = compile('let App = () => h1 { "hi" }')
    // Just `h1 { "hi" }` is 2 nodes (tag + text) — below threshold, stays as h() call.
    expect(js).not.toContain('"$static"')
    expect(js).toContain('h("h1", {}, ["hi"])')
  })

  it('M6.0: scoped ClassRef hash is baked into the static html', () => {
    // The Card body has 3 markup children (h1, p, style) — the style block
    // disqualifies static optimization on the OUTER `.card()`. Use a
    // scoped sibling subtree that's pure-static instead.
    const js = compile(`
      let Card = () => Fragment {
        .card() {
          h1 { "title" }
          p { "body" }
        }
        style { .card { padding: 1rem; } }
      }
    `)
    // The static html string should embed the per-component hashed class.
    // JSON.stringify escapes inner quotes, so the substring uses \" form.
    expect(js).toMatch(/"\$static",[^]*<div class=\\"card card-tu-[a-f0-9]{6}\\"/)
  })

  it('M6.0: static html escapes text + attribute special chars', () => {
    const js = compile(`
      let App = () => div(title: "<a&b>") {
        p { "x<y>&z" }
        p { "more" }
      }
    `)
    // Stored as JSON string literal — check the JSON-escaped form.
    // Attribute escape: < and & only (NOT >), per HTML attribute rules.
    expect(js).toContain('title=\\"&lt;a&amp;b>\\"')
    // Text escape: <, >, AND & all replaced.
    expect(js).toContain('x&lt;y&gt;&amp;z')
  })

  it('M6.1: component named-arg call emits a single props object', () => {
    const js = compile(`
      let Card = (props) => p { "x" }
      let App = () => Card(title: "hi", footer: "x")
    `)
    expect(js).toContain('Card({ "title": "hi", "footer": "x" })')
  })

  it('M6.1: named-arg call + trailing children merges into the props object', () => {
    const js = compile(`
      let Card = (props) => div { "x" }
      let App = () => Card(title: "hi") { p { "body" } }
    `)
    expect(js).toContain('Card({ "title": "hi", "children": [h("p", {}, ["body"])] })')
  })

  it('M6.1: positional component call still works (BC)', () => {
    const js = compile(`
      let Card = (label: string) => p { label }
      let App = () => Card("hi")
    `)
    expect(js).toContain('Card("hi")')
    expect(js).not.toContain('Card({')
  })

  it('M6.3: markdown { } block compiles to a $static vnode with rendered HTML', () => {
    const js = compile(`
      let App = () => div {
        markdown {
          # Hello

          Some **bold** text.
        }
      }
    `)
    expect(js).toContain('"$static"')
    expect(js).toContain('<h1>Hello</h1>')
    expect(js).toContain('<strong>bold</strong>')
    expect(js).toContain('class=\\"tu-markdown\\"')
  })

  it('M6.3: markdown indent dedents so 4-space-nested content isn\'t a code block', () => {
    const js = compile(`
      let App = () => div {
        markdown {
          # Heading

          Plain paragraph.

          - bullet
        }
      }
    `)
    // Without dedent, markdown-it would treat the indented lines as a
    // CommonMark code block and emit `<pre><code>`. After dedent the
    // paragraph and list render normally.
    expect(js).toContain('<p>Plain paragraph.</p>')
    expect(js).toContain('<ul>')
    expect(js).not.toContain('<pre><code>Plain paragraph')
  })

  it('M6.3: fenced code block inside markdown { } stays a code block', () => {
    const src = '\n      let App = () => div {\n        markdown {\n          # Hi\n\n          \\`\\`\\`js\n          const x = 1\n          \\`\\`\\`\n        }\n      }\n    '
    const js = compile(src.replace(/\\`/g, '`'))
    expect(js).toContain('<h1>Hi</h1>')
    expect(js).toContain('<pre><code')
    expect(js).toContain('const x = 1')
  })

  it('M5.6: object literal as a let-decl value emits the matching JS object', () => {
    // M8 Phase 3 wraps the value in `type.tag(__tu_anon_N, …)` so
    // `type.of(p)` recovers the synthesized `{x: number, y: number}` shape.
    const js = compile('let p = { x: 1, y: 2 }')
    expect(js).toContain('const p = new Signal.State(type.tag(__tu_anon_0, { x: 1, y: 2 }))')
    expect(js).toContain('__tu_anon_0 = type.struct("__anon", [{ name: "x", type: type.Number }, { name: "y", type: type.Number }])')
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
    // The literal preserves its quoted key; the M8 anon tag wraps the value.
    expect(js).toMatch(/new Signal\.State\(type\.tag\(__tu_anon_\d+, \{ "data-id": 7 \}\)\)/)
  })

  it('M5.6: nested object literal round-trips', () => {
    const js = compile('let p = { outer: { inner: 1 } }')
    // Outer anon descriptor is hoisted; inner object stays inline (Phase 3
    // emits inline `type.struct` for nested shapes inside an outer descriptor).
    expect(js).toMatch(/new Signal\.State\(type\.tag\(__tu_anon_\d+, \{ outer: \{ inner: 1 \} \}\)\)/)
  })

  it('M5.6: object literal as positional arg to a function call', () => {
    const js = compile(`
      let make = (opts) => opts
      let p = make({ x: 1 })
    `)
    expect(js).toContain('const p = new Signal.State(make({ x: 1 }))')
  })

  it('M6.10.1: shorthand prop `{ x, y, z: 1 }` desugars to `{ x: x, y: y, z: 1 }`', () => {
    // `{ id, title, done: false }` was the failing case in the
    // js-compat example pre-fix. Multi-prop shorthand works because
    // an `Ident` followed by `,` is unambiguously an object-literal
    // signal (Block bodies don't separate statements with `,`).
    const js = compile(`
      let id = 1
      let title = "hi"
      let mk = () => ({ id, title, done: false })
    `)
    expect(js).toContain('id: id.get()')
    expect(js).toContain('title: title.get()')
    expect(js).toContain('done: false')
  })

  it('M6.10.1: shorthand at the start of a multi-prop literal still detects ObjectLit', () => {
    // `{ id, more: 2 }` — the trailing colon-prop should still parse.
    const js = compile('let mk = (id) => ({ id, more: 2 })')
    expect(js).toContain('{ id: id, more: 2 }')
  })

  it('M6.10.1: member compound assign desugars `obj.x += 1` → `obj.x = obj.x + 1`', () => {
    const js = compile('let App = (obj: any) => { obj.x += 1; obj }')
    expect(js).toContain('(obj.x = (obj.x + 1))')
  })

  it('M6.10.1: index compound assign desugars `arr[i] += 1`', () => {
    const js = compile('let App = (arr: any, i: number) => { arr[i] += 1; arr }')
    expect(js).toContain('(arr[i] = (arr[i] + 1))')
  })

  it('M6.10.1: `obj.x ||= "default"` desugars to logical-or short-circuit', () => {
    const js = compile('let App = (obj: any) => { obj.x ||= "default"; obj }')
    expect(js).toContain('(obj.x = (obj.x || "default"))')
  })

  it('M6.10.1: cell-backed object compound assign unwraps via .get() on both reads', () => {
    // Top-level `let counts = { a: 0 }` is a Signal.State cell. The
    // compound desugar produces `counts.get().a = counts.get().a + 5`
    // — both the read and the target's host go through `.get()`. The
    // value itself is wrapped in M8's Phase 3 anon-tag.
    const js = compile(`
      let counts = { a: 0 }
      let bump = () => counts.a += 5
    `)
    expect(js).toMatch(/counts = new Signal\.State\(type\.tag\(__tu_anon_\d+, \{ a: 0 \}\)\)/)
    expect(js).toContain('(counts.get().a = (counts.get().a + 5))')
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

  it('M5.2: local `let` inside a block compiles to a JS `let` inside an IIFE', () => {
    const js = compile(`
      let App = () => {
        let greeting = "hi"
        p { greeting }
      }
    `)
    expect(js).toContain('let greeting = "hi"')
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
    expect(js).toContain('let a = 1')
    expect(js).toContain('let b = (a + 2)')
    expect(js).toContain('return h("p", {}, [b])')
  })

  it('M5.2: local `let` is a plain block-scoped binding, NOT wrapped in Signal.State', () => {
    const js = compile(`
      let App = () => {
        let count = 0
        p { count }
      }
    `)
    // Module-level lets wrap; local lets do not.
    expect(js).not.toContain('new Signal.State')
    expect(js).toContain('let count = 0')
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

  it('M6.4: try/catch as expression returns the matching branch value', () => {
    const js = compile('let parse = (s) => try { JSON.parse(s) } catch (e) { null }')
    expect(js).toContain('try {')
    expect(js).toContain('return JSON.parse(s)')
    expect(js).toContain('catch (e)')
    expect(js).toContain('return null')
  })

  it('M6.4: try/catch with TS-typed catch param preserves type in TS-emit, drops in JS', () => {
    const tu = 'let f = (fn) => { try { fn() } catch (e: unknown) { console.error(e) } }'
    expect(compile(tu)).toContain('catch (e)')
    expect(compileToTS(tu)).toContain('catch (e: unknown)')
  })

  it('M6.4: try requires at least catch or finally', () => {
    expect(() => compile('let f = () => try { foo() }')).toThrow(/catch.*finally/)
  })

  it('M6.4: throw inside if-stmt position emits clean `if (...) { throw ... }`', () => {
    const js = compile('let f = (x) => { if (x < 0) { throw "neg" }; x * 2 }')
    expect(js).toContain('if ((x < 0)) {')
    expect(js).toContain('throw "neg"')
    // No IIFE wrap around the throw — it's at statement position.
    expect(js).not.toContain('throw "neg"; })()')
  })

  it('M6.4: return inside if-stmt position escapes the outer lambda', () => {
    const js = compile('let f = (x) => { if (x < 0) { return 0 }; x * 2 }')
    // Lambda must be statement-bodied (not expression-bodied) so the
    // inner `return 0;` lands inside the lambda's `{ … }`, not inside
    // an IIFE that just returns from itself.
    expect(js).toMatch(/\(x\)\s*=>\s*\{/)
    expect(js).toContain('if ((x < 0)) {')
    expect(js).toContain('return 0;')
    expect(js).toContain('return (x * 2);')
  })

  it('M6.4: bare `return` is allowed and emits `return;`', () => {
    const js = compile('let f = () => { return }')
    expect(js).toMatch(/\(\)\s*=>\s*\{[\s\S]*return;[\s\S]*\}/)
  })

  it('M6.4: lambdas without control flow keep the cleaner expression-bodied form', () => {
    // Don't regress the common path: simple lambdas should still emit
    // `() => h(...)` rather than `() => { return h(...); }`.
    const js = compile('let App = () => div { "hi" }')
    expect(js).toContain('const App = () => h("div", {}, ["hi"])')
    expect(js).not.toContain('=> {')
  })

  it('M6.5: ternary `cond ? a : b` emits as JS conditional expression', () => {
    expect(compile('let f = (c) => c ? "y" : "n"')).toContain('(c ? "y" : "n")')
  })

  it('M6.5: ternary right-associates: `a ? b : c ? d : e` parses as `a ? b : (c ? d : e)`', () => {
    const js = compile('let f = (n) => n > 10 ? "big" : n > 0 ? "pos" : "non-pos"')
    expect(js).toContain('((n > 10) ? "big" : ((n > 0) ? "pos" : "non-pos"))')
  })

  it('M6.5: `new` operator', () => {
    expect(compile('let err = () => new Error("bad")')).toContain('(new Error("bad"))')
    expect(compile('let d = () => new Date().getTime()')).toContain('(new Date().getTime())')
  })

  it('M6.5: prefix and postfix `++`/`--` pass through as JS-native update', () => {
    expect(compile('let inc = () => ++count')).toContain('(++count)')
    expect(compile('let dec = () => count--')).toContain('(count--)')
  })

  it('M6.5: compound assignment `x += y` desugars to `x = x + y` (cell-aware via existing AssignExpr)', () => {
    expect(compile('export let count = 0\nlet inc = () => count += 1')).toContain('count.set((count.get() + 1))')
    expect(compile('let label = "x"\nlet init = () => label ||= "default"')).toContain('(label.get() || "default")')
  })

  it('M6.5: spread `...` in call args, array, and object literals', () => {
    const js = compile(`
      let merge = (a, b) => [...a, ...b, 99]
      let extend = (o) => ({ ...o, key: 1 })
      let fwd = (fn, args) => fn(...args, "end")
    `)
    expect(js).toContain('[...a, ...b, 99]')
    expect(js).toContain('{ ...o, key: 1 }')
    expect(js).toContain('fn(...args, "end")')
  })

  it('M6.5: template literals with interpolation round-trip to JS template strings', () => {
    expect(compile('let g = (n) => `hi ${n}!`')).toContain('`hi ${n}!`')
    // Nested templates are independent — outer parser sees inner ` as
    // start of a fresh template inside the embedded expression.
    expect(compile('let h = (a, b) => `${a}, ${`inner ${b}`}, end`')).toContain(
      '`${a}, ${`inner ${b}`}, end`'
    )
  })

  it('M6.5: template chunk escape sequences decoded correctly', () => {
    expect(compile('let g = () => `a\\`b\\\\c$\\${not-an-expr}`')).toContain('`a\\`b\\\\c$\\${not-an-expr}`')
  })

  it('M6.6: async lambda emits `async (…) =>` and statement-bodied form', () => {
    const js = compile('let f = async (id) => { let r = await fetch(`/api/${id}`); r.json() }')
    expect(js).toContain('async (id) => {')
    expect(js).toContain('(await fetch(')
    expect(js).toContain('return r.json()')
  })

  it('M6.6: async lambda with try-catch body emits clean async stmt-form (no inner IIFE)', () => {
    // The previous expression-body path wrapped the try in a sync
    // IIFE, which made any embedded `await` a syntax error. Statement
    // form keeps the await inside the async scope.
    const js = compile('let f = async (url) => try { await fetch(url) } catch (e) { null }')
    expect(js).toContain('async (url) => {')
    expect(js).toContain('try {')
    expect(js).toContain('return (await fetch(url))')
    expect(js).toContain('} catch (e) {')
    // Crucially no inner sync IIFE — only the outer async lambda itself.
    expect(js).not.toContain('(() => {')
  })

  it('M6.6: dynamic `import("mod")` round-trips to JS dynamic import', () => {
    const js = compile('let live = async () => { let m = await import("./live-demo.js"); m.start() }')
    expect(js).toContain('await import("./live-demo.js")')
  })

  it('M6.6: `(await x).foo()` parses correctly via paren-expr postfix', () => {
    const js = compile('let load = async (url) => (await fetch(url)).json()')
    expect(js).toContain('(await fetch(url)).json()')
  })

  it('M6.6: synchronous lambdas keep expression-bodied form (no async wrap)', () => {
    // Don't regress: a sync lambda without control flow still emits the
    // tighter `() => h(...)` form, not the async / statement-bodied path.
    const js = compile('let App = () => div { "hi" }')
    expect(js).toContain('const App = () => h("div", {}, ["hi"])')
    expect(js).not.toContain('async')
  })

  it('M6.9: external JS pastes the body verbatim into a JS arrow', () => {
    // Body source is opaque to Tu — comments, JS-only operators, and
    // nested braces all round-trip exactly.
    const js = compile('let dbl = external JS (a) { /* raw */ return a * 2 }')
    expect(js).toContain('const dbl = (a) => {')
    expect(js).toContain('/* raw */')
    expect(js).toContain('return a * 2')
  })

  it('M6.9: external JS classifies as function (not a state cell)', () => {
    // Without this the let would be wrapped in `new Signal.State(...)`,
    // which is wrong for a function value — calls would fail at runtime.
    const js = compile('let fn = external JS () { return 1 }')
    expect(js).not.toContain('Signal.State')
    expect(js).toContain('const fn = () => {')
  })

  it('M6.9: `async external JS` sets the async modifier on the emitted arrow', () => {
    const js = compile('let load = async external JS (url) { const r = await fetch(url); return r.json() }')
    expect(js).toContain('async (url) => {')
    expect(js).toContain('await fetch(url)')
  })

  it('M6.9: external JS preserves param + return-type annotations in TS-shadow', () => {
    const ts = compileToTS('let safe = external JS (s: string): string { return s.trim() }')
    expect(ts).toContain('(s: string): string')
  })

  it('M6.9: external JS body brace-counts so nested objects do not close early', () => {
    const js = compile('let make = external JS () { const o = { a: { b: 1 } }; return o }')
    expect(js).toContain('const o = { a: { b: 1 } }')
    expect(js).toContain('return o')
  })

  it('M6.9: external JS return type can start with `{` (object shape)', () => {
    // Pre-fix bug: `parseRawTypeUntilBrace` stopped at the first `{`
    // at depth 0, mis-reading the type's opening brace as the body
    // opener and breaking parse.
    const ts = compileToTS(
      'let make = external JS (xs: number[]): { ms: number; out: any[] } { const t0 = performance.now(); return { ms: performance.now() - t0, out: xs } }'
    )
    expect(ts).toContain(': { ms: number; out: any[] }')
    expect(ts).toContain('return { ms: performance.now() - t0, out: xs }')
  })

  it('M6.9: external JS return type can be `{ … } & Tail` (intersection)', () => {
    // After the `{ … }` literal closes, the type continues with `&`.
    // The lookahead rule consumes the literal and keeps going because
    // the next token (`&`) is not the body opener.
    const ts = compileToTS(
      'let mk = external JS (): { a: 1 } & { b: 2 } { return Object.assign({ a: 1 }, { b: 2 }) }'
    )
    expect(ts).toContain(': { a: 1 } & { b: 2 }')
  })

  // ─── M8 Phase 2 — `interface` keyword + runtime descriptor codegen ───

  it('M8: emits both a TS interface AND a runtime descriptor const', () => {
    const ts = compileToTS(['interface User {', '  id: number', '  name: string', '}'].join('\n'))
    expect(ts).toMatch(/interface User \{[\s\S]*?id: number[\s\S]*?name: string[\s\S]*?\}/)
    expect(ts).toContain(
      'const User: __tu_TypeDescriptor = type.struct("User", [{ name: "id", type: type.Number }, { name: "name", type: type.String }])'
    )
    expect(ts).toContain(
      `import { type, type TypeDescriptor as __tu_TypeDescriptor } from '@tu-lang/std'`
    )
  })

  it('M8: JS mode erases the interface but keeps the runtime descriptor', () => {
    const js = compile('interface User { id: number\n name: string }')
    expect(js).not.toContain('interface User')
    expect(js).toContain(
      'const User = type.struct("User", [{ name: "id", type: type.Number }, { name: "name", type: type.String }])'
    )
    expect(js).toContain(`import { type } from '@tu-lang/std'`)
  })

  it('M8: export interface emits export modifier on both sides', () => {
    const ts = compileToTS('export interface User { id: number }')
    expect(ts).toContain('export interface User {')
    expect(ts).toContain('export const User: __tu_TypeDescriptor')
  })

  it('M8: nullable union `T | null` maps to type.Optional(T)', () => {
    const js = compile('interface U { email: string | null }')
    expect(js).toContain('{ name: "email", type: type.Optional(type.String) }')
  })

  it('M8: array sugar `T[]` maps to type.Array(T)', () => {
    const js = compile('interface U { tags: string[]\n scores: number[] }')
    expect(js).toContain('{ name: "tags", type: type.Array(type.String) }')
    expect(js).toContain('{ name: "scores", type: type.Array(type.Number) }')
  })

  it('M8: optional field marker `?:` flows through to the descriptor', () => {
    const js = compile('interface U { id: number\n bio?: string }')
    expect(js).toContain('{ name: "id", type: type.Number }')
    expect(js).toContain('{ name: "bio", type: type.String, optional: true }')
  })

  it('M8: nested interface reference compiles to a bare identifier (the runtime const)', () => {
    const js = compile(['interface Inner { x: number }', 'interface Outer { inner: Inner }'].join('\n'))
    expect(js).toContain('{ name: "inner", type: Inner }')
  })

  it('M8: function-typed field falls back to type.Function', () => {
    const js = compile('interface H { onClick: (e: Event) => void }')
    expect(js).toContain('{ name: "onClick", type: type.Function }')
  })

  it('M8: real (non-null) union falls back to type.Object until M9 ships', () => {
    const js = compile('interface E { kind: string | number }')
    expect(js).toContain('{ name: "kind", type: type.Object }')
  })

  it('M8: no interface — no auto-import for @tu-lang/std', () => {
    const js = compile('export let count = 0')
    expect(js).not.toContain('@tu-lang/std')
  })

  it('M8 Phase 2.5: typed `let X: I = { … }` wraps value in type.tag(I, …)', () => {
    const js = compile([
      'interface User { id: number; name: string }',
      'let alice: User = { id: 1, name: "Alice" }',
    ].join('\n'))
    expect(js).toContain('new Signal.State(type.tag(User, { id: 1, name: "Alice" }))')
  })

  it('M8 Phase 2.5: array-typed let does NOT inject tag', () => {
    const js = compile('let xs: number[] = [1, 2, 3]')
    expect(js).not.toContain('type.tag')
    // No interface in the file → no @tu-lang/std import either.
    expect(js).not.toContain('@tu-lang/std')
  })

  it('M8 Phase 3: untyped `let X = { … }` synthesizes anon descriptor + wraps with type.tag', () => {
    const js = compile('let p = { x: 1, y: 2 }')
    expect(js).toContain(`import { type } from '@tu-lang/std'`)
    expect(js).toContain(
      'const __tu_anon_0 = type.struct("__anon", [{ name: "x", type: type.Number }, { name: "y", type: type.Number }])'
    )
    expect(js).toContain('new Signal.State(type.tag(__tu_anon_0, { x: 1, y: 2 }))')
  })

  it('M8 Phase 3: same-shape untyped lets share ONE descriptor (interning)', () => {
    const js = compile([
      'let p1 = { x: 1, y: 2 }',
      'let p2 = { x: 10, y: 20 }',
    ].join('\n'))
    // Only ONE __tu_anon_N decl — both lets reuse it.
    const anonDecls = js.match(/const __tu_anon_\d+ = type\.struct/g) ?? []
    expect(anonDecls).toHaveLength(1)
    expect(js).toContain('p1 = new Signal.State(type.tag(__tu_anon_0, { x: 1, y: 2 }))')
    expect(js).toContain('p2 = new Signal.State(type.tag(__tu_anon_0, { x: 10, y: 20 }))')
  })

  it('M8 Phase 3: different shapes get fresh descriptors', () => {
    const js = compile([
      'let p = { x: 1, y: 2 }',
      'let q = { title: "hi", count: 3 }',
    ].join('\n'))
    expect(js).toContain('__tu_anon_0 = type.struct')
    expect(js).toContain('__tu_anon_1 = type.struct')
  })

  it('M8 Phase 3: shape interning is order-insensitive', () => {
    // `{x:1,y:2}` and `{y:2,x:1}` are the same shape — share one descriptor.
    const js = compile([
      'let a = { x: 1, y: 2 }',
      'let b = { y: 20, x: 10 }',
    ].join('\n'))
    const anonDecls = js.match(/const __tu_anon_\d+ = type\.struct/g) ?? []
    expect(anonDecls).toHaveLength(1)
  })

  it('M8 Phase 3: nested object types compile inline inside the outer descriptor', () => {
    const js = compile('let p = { outer: { inner: 1 } }')
    // Outer is hoisted; inner is inline as `type.struct(...)`.
    expect(js).toContain(
      `const __tu_anon_0 = type.struct("__anon", [{ name: "outer", type: type.struct("__anon", [{ name: "inner", type: type.Number }]) }])`
    )
  })

  it('M8 Phase 3: array literal in field maps to type.Array(<elem>)', () => {
    const js = compile('let p = { tags: ["a", "b"] }')
    expect(js).toContain(
      'const __tu_anon_0 = type.struct("__anon", [{ name: "tags", type: type.Array(type.String) }])'
    )
  })

  it('M8 Phase 3: bool / null / lambda field shapes detected', () => {
    const js = compile('let card = { active: true, hint: null, click: () => 0 }')
    expect(js).toContain('{ name: "active", type: type.Boolean }')
    expect(js).toContain('{ name: "hint", type: type.Null }')
    expect(js).toContain('{ name: "click", type: type.Function }')
  })

  it('M8 Phase 3: spread in object literal disables synthesis (Phase 3d work)', () => {
    const js = compile([
      'let base = { x: 1 }',
      'let merged = { ...base, y: 2 }',
    ].join('\n'))
    // `base` synthesizes; `merged` does NOT (spread is unhandled).
    expect(js).toContain('const __tu_anon_0 = type.struct')
    // No tag wrapper around merged — falls back to bare object.
    expect(js).toMatch(/const merged = new Signal\.State\(\{[\s\S]*?\.\.\.base/)
  })

  it('M8 Phase 3: empty object literal does NOT trigger synthesis', () => {
    const js = compile('let empty = {}')
    expect(js).not.toContain('__tu_anon_')
    expect(js).not.toContain('type.tag')
  })

  it('M8 Phase 3: known interface ident in field resolves to that interface', () => {
    const js = compile([
      'interface User { id: number }',
      'let alice: User = { id: 1 }',
      'let box = { user: alice, label: "wrap" }',
    ].join('\n'))
    // The `user` field references `alice`, which is an Ident; the synth
    // pass detects `alice` is NOT a known interface (it's a let cell),
    // so falls back to type.Object. `User` IS known but the field's
    // type is determined by the value expression, not by `alice`'s
    // declaration. This is conservative — Phase 3 polish can widen it.
    expect(js).toContain('{ name: "user", type: type.Object }')
    expect(js).toContain('{ name: "label", type: type.String }')
  })

  it('M8 Phase 4: `typeof v` is banned with a directive error pointing at type.of', () => {
    expect(() => compile('let App = (v: any) => typeof v')).toThrow(/typeof.*banned.*type\.of/i)
  })

  it('M8 Phase 4: `v instanceof T` is banned with a directive error pointing at type.is', () => {
    expect(() => compile('let App = (v: any) => v instanceof Promise')).toThrow(
      /instanceof.*banned.*type\.is/i
    )
  })

  // ─── Exception system Phase 1 — `Exception X { … }` declaration ──

  it('Exception decl emits a TS interface extending Error + a callable factory', () => {
    const ts = compileToTS('Exception NotFoundError { resource?: string }')
    expect(ts).toContain('interface NotFoundError extends Error {')
    expect(ts).toContain('resource?: string')
    expect(ts).toContain(
      'const NotFoundError: ((message: string, props?: { resource?: string }) => NotFoundError) & __tu_TypeDescriptor'
    )
  })

  it('Exception decl JS-mode emits a factory function with stack-trace capture', () => {
    const js = compile('Exception OopsError { code: number }')
    expect(js).toContain('const OopsError =')
    expect(js).toContain('e.name = "OopsError"')
    expect(js).toContain('Error.captureStackTrace')
    // Native descriptor merged via Object.assign.
    expect(js).toContain('type.native("OopsError",')
    expect(js).toContain('Object.assign(factory, descriptor)')
  })

  it('Exception decl factory copies optional fields when present', () => {
    const js = compile('Exception E { code?: number; reason?: string }')
    expect(js).toContain('if (props["code"] !== undefined)')
    expect(js).toContain('if (props["reason"] !== undefined)')
  })

  it('Exception decl auto-imports type from @tu-lang/std', () => {
    const js = compile('Exception E { resource: string }')
    expect(js).toContain(`import { type } from '@tu-lang/std'`)
  })

  it('Exception decl supports export modifier', () => {
    const ts = compileToTS('export Exception PublicError { code: number }')
    expect(ts).toContain('export interface PublicError extends Error {')
    expect(ts).toContain('export const PublicError:')
  })

  it('Exception construction (no `new` keyword) compiles to a regular call', () => {
    const js = compile([
      'Exception NotFoundError { resource: string }',
      'let raise = () => throw NotFoundError("missing", { resource: "user" })',
    ].join('\n'))
    expect(js).toContain('throw NotFoundError("missing", { resource: "user" })')
  })

  // ─── Exception system Phase 2 — throws clause `(): R ? E1|E2` ──

  it('Phase 2: throws clause splits on top-level `?` (return type kept; throws erased)', () => {
    const ts = compileToTS([
      'Exception NotFoundError { resource: string }',
      'let lookup = (id: string): string ? NotFoundError => "fallback"',
    ].join('\n'))
    expect(ts).toContain('const lookup = (id: string): string =>')
    // `? NotFoundError` is NOT in the TS shadow (TS has no throws clauses).
    expect(ts).not.toContain('? NotFoundError')
  })

  it('Phase 2: multi-error throws clause `R1|R2 ? E1|E2`', () => {
    const ts = compileToTS('let f = (): string|number ? AError|BError => 0')
    expect(ts).toContain('const f = (): string|number =>')
    expect(ts).not.toContain('? AError')
  })

  it('Phase 2: question-marks INSIDE generic args do NOT split', () => {
    // `Map<string, V?>` — the `?` is inside `<…>` so depth > 0; the
    // top-level split skips it. (TS doesn't have `V?` standalone but
    // the splitter must be conservative around generic args.)
    const ts = compileToTS('let f = (): Map<string, number> => new Map()')
    expect(ts).toContain('const f = (): Map<string, number> =>')
  })

  it('Phase 2: throws clause omitted compiles like before (no regression)', () => {
    const ts = compileToTS('let f = (): string => "x"')
    expect(ts).toContain('const f = (): string => "x"')
  })

  // ─── Exception system Phase 3 — typed catch ───────────────────────

  it('Phase 3: typed catch param emits `: unknown` in TS shadow (TS rule)', () => {
    const ts = compileToTS([
      'Exception AError { code: number }',
      'let safe = () => try { throw AError("x", { code: 1 }) } catch (e: AError) { 0 }',
    ].join('\n'))
    // TS rejects `catch (e: AError)` — codegen rewrites to `: unknown`.
    expect(ts).toContain('catch (e: unknown)')
    expect(ts).not.toContain('catch (e: AError)')
  })

  it('Phase 3: union-typed catch + type.is dispatch in body works', () => {
    const js = compile([
      'Exception AError { code: number }',
      'Exception BError { msg: string }',
      'let safe = () => try {',
      '  throw AError("x", { code: 1 })',
      '} catch (e: AError | BError) {',
      '  if (type.is(e, AError)) { "a" } else { "b" }',
      '}',
    ].join('\n'))
    // Both error decls + descriptors emitted.
    expect(js).toContain('const AError =')
    expect(js).toContain('const BError =')
    // Catch dispatch via type.is in the body.
    expect(js).toContain('type.is(e, AError)')
  })

  it('Exception decl coexists with interface decl in the same file', () => {
    const js = compile([
      'interface User { id: number }',
      'Exception NotFoundError { resource: string }',
    ].join('\n'))
    expect(js).toContain('const User = type.struct')
    expect(js).toContain('const NotFoundError =')
    expect(js).toContain('type.native("NotFoundError"')
  })

  it('M8 Phase 4: external JS body still allows `typeof` / `instanceof` (escape hatch)', () => {
    // The body of `external JS { … }` is passed through verbatim — the
    // ban rule keys on Tu-source tokens, not on JS bytes inside the
    // escape hatch.
    const js = compile('let isObj = external JS (v: any): boolean { return typeof v === "object" && v instanceof Object }')
    expect(js).toContain('typeof v === "object"')
    expect(js).toContain('v instanceof Object')
  })

  it('M8 Phase 2.5: imported interface name does NOT trigger injection (Phase 3 work)', () => {
    // Cross-module classification of imports is a Phase 3 concern;
    // until then conservative codegen skips tag injection so we don't
    // emit `type.tag(typeAliasName, …)` calls that error at runtime.
    const js = compile([
      'import { User } from "./user.tu"',
      'let bob: User = { id: 2, name: "Bob" }',
    ].join('\n'))
    // No injection — User isn't classified as an interface here.
    expect(js).not.toContain('type.tag')
    // No std auto-import either, since the rule keys on local interface decls.
    expect(js).not.toContain(`'@tu-lang/std'`)
  })

  it('M8: interface + type alias coexist (alias still compiles to TS-erased)', () => {
    const ts = compileToTS(['type Variant = "a" | "b" | "c"', 'interface Card { variant: Variant }'].join('\n'))
    expect(ts).toContain('type Variant = "a" | "b" | "c"')
    expect(ts).toContain(
      'const Card: __tu_TypeDescriptor = type.struct("Card", [{ name: "variant", type: Variant }])'
    )
  })
})
