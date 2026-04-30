# Tu Language Reference

A practical reference for every Tu syntactic form that compiles today. Covers
the language as of the M5.x line — see [DEFERRED.md](./DEFERRED.md) for
work still in flight.

Tu is a single-pass, expression-oriented language that compiles to a small
ESM module per `.tu` file. The compiler also emits a TypeScript shadow with
preserved type annotations and an inline V3 source map. Every top-level
binding can be read from JS / TS via standard `import`.

---

## File structure

A `.tu` file is a sequence of top-level statements separated by whitespace.
There's no statement terminator (no `;` at the top level; `;` is reserved
for type-spans only).

Allowed top-level forms:

- `let X = …` — module-private value binding
- `export let X = …` — public value binding
- `let X: T = …` / `export let X: T = …` — annotated binding
- `type X = …` / `export type X = …` — type alias
- `import { … } from "./other.tu"` — named import
- `export { … } from "./other.tu"` — named re-export

Comments use `//` (line) — there is no block-comment form yet.

```tu
// A complete file:
import { Card } from "./Card.tu"

export let count = 0

export type Pair = { x: number, y: number }

export let App = () => div { Card("hi") }
```

---

## Bindings

### `let X = value`

`let` declares a top-level binding. The value is evaluated at module
initialization. The classification (state / computed / function) drives how
reads compile:

- **`let X = (…) => …`** — lambda. `X` reads as a plain identifier; calls
  invoke the function as expected.
- **`let X = computed(expr)`** — computed cell. `X.get()` returns the
  derived value; the runtime auto-tracks dependencies and invalidates on
  change.
- **`let X = anything else`** — state cell. Wraps the value in
  `Signal.State`; `X.get()` reads, `X = newVal` writes (codegen rewrites
  to `X.set(newVal)`).

```tu
let count = 0                            // Signal.State<number>
let doubled = computed(count * 2)        // Signal.Computed<number>
let inc = () => count = count + 1        // function
```

Reads inside a lambda body that reach back to a top-level state / computed
cell get an automatic `.get()` injection:

```tu
export let App = () => p { count }
// emits: () => h("p", {}, [count.get()])
```

A lambda parameter shadowing a top-level cell stays as a plain identifier:

```tu
let name = "outer"
export let G = (name: string) => p { name }
// emits: (name) => h("p", {}, [name])  -- no .get()
```

### `export let X = value`

Same as `let`, but the binding is part of the module's public surface. Only
`export let` declarations appear in the emitted `.d.ts`.

### Annotated bindings

Add `: T` between the name and `=` to give the binding an explicit TS type.
The annotation is captured as a raw source slice and threaded into the TS
shadow, with appropriate Signal wrapping:

| Tu source                                  | Emitted TS const type                       |
| ------------------------------------------ | ------------------------------------------- |
| `let App: () => string = …`                | `const App: () => string`                   |
| `let count: number = 0`                    | `const count: Signal.State<number>`         |
| `let total: number = computed(…)`          | `const total: Signal.Computed<number>`      |
| `let cell: Signal.State<MyShape> = …`      | `const cell: Signal.State<MyShape>` (no double-wrap — codegen detects the explicit Signal prefix) |

The annotation is erased in JS-mode emission.

### Local `let` inside a block

A `let X = expr` written **inside a block body** declares a block-scoped
const — it does NOT become a Signal cell. Useful for closures and small
computations:

```tu
let Greet = (name: string) => {
  let greeting = "Hello, " + name + "!"
  let upper = greeting   // any plain JS expression
  p { upper }
}
```

Local lets shadow same-named top-level cells inside that block (reads
emit as bare idents, no `.get()` injection). Type annotations are
supported via the same raw-slice mechanism.

---

## Type aliases

```tu
type Pair = { x: number, y: number }
export type Color = "red" | "green" | "blue"
```

The RHS is captured as a raw source slice (Tu doesn't parse types itself —
the TS compiler does at the `tu check` / IDE step). Type aliases erase
entirely from JS-mode output.

`type` is a contextual keyword: it triggers only when followed by `Ident =`
at statement boundary. So a lambda param named `type` still works:

```tu
export let f = (type: string) => p { type }
```

---

## Values

### Literals

```tu
"a string"   // StringLit
42           // NumberLit
[1, 2, 3]    // ArrayLit
[]           // empty ArrayLit
```

Strings support common escapes: `\n`, `\t`, `\r`, `\"`, `\\`. Numbers are
integers only at the syntactic level (decimal-point parsing not in V1).

### Identifiers

A bare identifier reads the binding by that name. Resolution follows
JS-style lexical scope (lambda params, `for` binders, then top-level lets).

### Arithmetic and comparison

```tu
a + b   a - b   a * b   a / b   a % b
a == b  a != b   // -- compile to JS strict ===, !==
a < b   a <= b   a > b   a >= b
```

Pratt precedence: `* / %` > `+ -` > comparison > equality.

### Lambdas

```tu
(x) => x + 1
(x: number) => x + 1
(name: string, age: number) => p { name }
() => p { "hi" }
```

The body is any expression (including a Block). Param type annotations
preserve through TS-mode emission for inference. JS-mode strips them.

### Calls

```tu
foo(arg, another)        // CallExpr — positional args
```

Identifiers followed by `(` and positional args (no `Ident:` at the front)
parse as call expressions. The result is whatever the function returns.

### Blocks

```tu
{
  someStmt
  anotherStmt
  finalExpr      // value of the block
}
```

Blocks compile to an IIFE when there are 2+ statements (each non-final
statement evaluated for side effects, the final one is the block's value).
A 1-statement block compiles to `(stmt)`. An empty block is `(undefined)`.

---

## Markup (tag-calls)

Markup uses a trailing-closure DSL. **Capitalization is the
discriminator between HTML tags and user components** (React/JSX
convention):

- **Lowercase** identifier → `h("tag", props, children)` (HTML element)
- **Uppercase** identifier → `Callee(args, [children])` (component
  function call). tsserver sees the call as a real function — hover,
  goto-definition, and completion all work on the component name.

### Bare tag with children

```tu
div { "hello" }
ul {
  li { "a" }
  li { "b" }
}
```

### Tag with named props

```tu
button(onClick: handler, disabled: false) { "click" }
img(src: "logo.svg", alt: "logo")
```

A `(Ident: …)` opener disambiguates tag-calls from positional calls. With
no explicit-prop opener (and no children block), it parses as a positional
call instead.

### Component invocation

```tu
import { Card } from "./Card.tu"

let App = () => Card("Alice") {
  p { "Body content" }
}
```

The component lambda conventionally takes `children` as its last
positional parameter:

```tu
let Card = (name: string, children: Child[]) => .card() {
  h2 { "Hello, " name "!" }
  children
}
```

`children` is an array of children that the runtime's flatten step
splices into the parent's children list at render time. **Use `Child[]`
(not `VNode[]`)** for the type — `Child = VNode | string | number | null
| undefined | Child[]` reflects the runtime contract, and a component
body that ends in a `style` block returns an array fragment, which
`VNode[]` would reject. Both `Child` and `VNode` are auto-imported from
`@tu/runtime` in TS-mode emit, so the annotation resolves without an
explicit user import.

### Fragment

`Fragment { … }` from `@tu/runtime` lets a component return multiple
sibling vnodes without an enclosing wrapper element (React's `<>…</>`):

```tu
import { Fragment } from "@tu/runtime"

let Layout = (title: string, children: Child[]) => Fragment {
  header { h1 { title } }
  main { children }
  footer { "© 2026" }
}
```

### Pug-style class shorthand

```tu
.card { "body" }                       // <div class="card-tu-h">body</div>
.card.shadow() { "body" }              // multi-class — class="card-tu-h shadow-tu-h"
.card(tag: "section") { "body" }       // override default `div`
```

The leading `.foo` chains gather class refs; an optional `(tag: "literal")`
overrides the synthetic tag (must be a string literal). Adding an explicit
`class:` prop is a compile error — the shorthand already binds `class`.

### Children

Inside a `{ … }` children block, allowed shapes are:

- text (`StringLit`, `NumberLit`)
- identifier reads
- nested tag-calls / call-exprs
- arithmetic / comparison
- `if` / `for` / `style` / `ClassRef`
- array literals (flatten via the runtime)

Lambdas, bare blocks, and assignments are NOT valid as direct children — Tu
rejects them at parse time.

---

## Control flow

### `if` / `else`

```tu
if (count == 0) { "no items" }
else if (count == 1) { "1 item" }
else { "many items" }
```

`if` is an expression. `else` is optional (`undefined` fallthrough). Else-if
chains stay flat.

### `for`

```tu
for item in items {
  li { item }
}
```

`item` is the loop binding. `items` must be iterable at runtime. Compiles
to `Array.from(items, (item) => …)`. The iter-expression's tail `{ … }` is
NOT treated as a tag-call children block during this parse — the trailing
brace belongs to the loop body.

---

## Reactivity

Tu wraps non-lambda top-level lets in TC39 `Signal.State`. Reads inside
lambda bodies auto-inject `.get()`; writes via `=` rewrite to `.set(…)`:

```tu
let count = 0
let inc = () => count = count + 1   // emits: count.set((count.get() + 1))
```

`computed(expr)` cells are invalidated when any cell read by `expr`
changes. Assigning to a computed cell is a compile error.

`mount(thunk, container)` from `@tu/runtime` wires a thunk into the DOM
and re-renders on cell mutation. The keyed diff reuses element identity
across renders (M1.7); LIS-based reorder minimizes moves on long-range
list shuffles (M1.15).

`hydrate(thunk, container)` (M4 V1) is the SSR counterpart: instead of
creating new DOM, it adopts an existing subtree (typically rendered by
`renderToString` on the server) and only attaches event listeners /
DOM-property props that SSR couldn't serialize. Subsequent renders run
the normal patchChildren diff. Adjacent text vnodes that the server
fused into a single Text node are split during hydration so cell updates
can target individual fragments (`p { "count = " count }` keeps the
static prefix Text node untouched when `count` ticks).

`defineCustomElement(thunk, tagName)` (M4.1) registers a Tu thunk as a
standard Custom Element. The element mounts on `connectedCallback`,
stops on `disconnectedCallback`, and re-renders reactively while
connected. V1 caveats: the thunk's reactive scope is the module's
top-level cells (multiple instances share state), and HTML attributes
don't auto-bind to Tu cells yet.

---

## Style block

```tu
let App = () => {
  div(class: .card) { "hi" }
  style {
    .card { padding: 1rem; }
  }
}
```

A `style { … }` block emits an `<style>` HTML element sibling to the main
component vnode. The CSS body is preserved verbatim (Tu doesn't parse CSS).

### Top-level rules must be class-rooted (M5/D)

Every top-level rule's selector list must start with `.` (a class
selector), `:global(…)` (escape hatch), or `@` (at-rule like `@media`).
Element selectors at top level (`p { … }`) raise a compile error to
prevent global bleed:

```tu
style {
  .card { padding: 1rem; }                  // ✅ class-rooted
  .card .title { font-size: 1.25rem; }      // ✅ compound, still rooted
  :global(.legacy-modal) { z-index: 9999; } // ✅ escape hatch
  @media (min-width: 600px) { … }           // ✅ at-rule

  p { color: red; }                         // ❌ compile error
}
```

For element selectors that only apply within a class, switch to CSS4
nesting (modern browsers handle natively):

```tu
.card {
  padding: 1rem;
  > h2 { font-size: 1.25rem; }   // applies to .card > h2
  &:hover { background: #eee; }  // applies to .card:hover
}
```

### Scoped classes (dual-name injection — M5/F)

When a component contains a `style` block AND any `.classRef` references
in the markup, Tu hashes every declared class with a per-component FNV-1a
suffix (`-tu-{6 hex}`). The markup carries **both** the original name and
the hashed one (space-joined); CSS selectors use the hashed form only:

```tu
let Card = () => {
  div(class: .card) { "hi" }
  // → class="card card-tu-a1b2c3"  (original + hashed)

  style { .card { padding: 1rem; } }
  // → .card-tu-a1b2c3 { padding: 1rem; }  (hashed only)
}
```

Two components declaring the same class name get different hashes — the
component-scoped styles don't bleed. The unhashed name on markup lets
global CSS / dev-tool inspection / framework theming layers still target
`.card` if needed.

### `:global(.foo)` escape hatch

```tu
style {
  .card { padding: 1rem; }
  :global(.legacy-modal) { z-index: 9999; }
  .card :global(.icon) { color: red; }
}
```

Classes inside a `:global(...)` wrapper bypass the hash. The wrapper itself
is stripped from the output. Compound selectors mix freely:
`.card :global(.icon)` becomes `.card-tu-h .icon`.

### ClassRef syntax

Outside a style block, `.foo` is a *reference* to a declared class. Three
shapes:

- `class: .foo` — bind a single class
- `class: .foo.bar` — bind multiple classes (space-joined at runtime)
- `.foo() { … }` — pug shorthand: synthesizes `div(class: .foo) { … }`

ClassRefs to classes NOT declared in the surrounding component's `style`
block raise a compile error. Outside any scoped component, ClassRefs are
also disallowed (no place to hash to).

---

## Imports / exports

### Named import

```tu
import { Card, Header } from "./Card.tu"
```

Relative `.tu` paths are resolved by the compiler. The import maps to a
standard ESM `import` in the JS output (and `.ts` extension in the TS
shadow so tsserver resolves the sibling shadow file).

### Re-export

```tu
export { Card } from "./Card.tu"
```

Same as `import { Card }` followed by `export { Card }`, but in one
statement and without binding `Card` locally.

### Cross-`.tu` reactivity (M2.3)

When the LSP, `tu check`, or the `@tu/vite` plugin compile a graph of
`.tu` files, they pre-classify each file's `export let` bindings (state /
computed / function). The compiler uses that classification to inject
`.get()` for imported state cells, so:

```tu
// cell.tu
export let count = 0

// App.tu
import { count } from "./cell.tu"
export let App = () => p { count }   // emits: count.get()
```

works as expected. Outside a graph context (the standalone `compile()`
call from a string), imports default to "function" classification —
which emits a bare ident at the read site.

---

## Type system

Tu's type system delegates to TypeScript via an emitted shadow file. Each
`.tu` compiles to:

- A JS module (runtime) — types erased
- A TS module (typecheck / `.d.ts` emit) — types preserved

The TS shadow looks like normal TypeScript: `Signal.State<T>` cells,
`Signal.Computed<T>` cells, function lambdas with declared param types,
`type X = …` aliases, and (for exported lambdas with all-typed params) a
synthesized `interface ${Name}Props { … }`.

`tu check <file>` runs the shadow through tsserver and pretty-prints
diagnostics back at the `.tu` source. The `@tu/lsp` package exposes the
same logic plus hover, completion, definition, and rename — all token-
ranged so squiggles / underlines target individual identifiers.

`.d.ts` emission via `tsc --emitDeclarationOnly` over the shadow gives
downstream TS consumers a clean declaration file with only the public
`export let` / `export type` surface.

---

## What's not in V1

See [DEFERRED.md](./DEFERRED.md) for the live list. As of M3.9 / M2.5 the
notable gaps are:

- **Default exports** — TBD; revisit when component-as-file becomes idiomatic.
- **Suspense / async components** — no async story yet.
- **Per-component fine-grained HMR** — full module re-import on save.
- **Local reactivity** — full thunk re-runs on cell mutation; per-binding
  patches are deeper rework.
- **CSS4 nesting / `@layer` / `@scope`** — needs a real CSS parser; the
  regex-based scanner handles most flat selectors today.
- **Static-HTML optimization** — non-reactive subtrees still go through
  `h()` instead of `<template>`-cloned strings.
- **Style ↔ JS state interop** — bind CSS custom properties to cells via
  a syntax sugar (post-M2 work).
