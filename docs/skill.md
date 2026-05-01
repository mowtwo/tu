# Tu — Agent Skill

> **Audience**: LLM agents (Claude, GPT, etc.) that need to write or reason about Tu source code. This page is written for ingestion by automated tools — copy-paste it into a system prompt, save it as `.claude/skills/tu/SKILL.md`, or `fetch` it programmatically. A plain-text version is mirrored at [`/llms.txt`](./llms.txt).

## Identity (the one-liner you need to keep in mind)

Tu is a **reactive UI language** that compiles to JS/TS. It is **JS-superset-with-types-via-TS** in spirit — most JS expression-level constructs work, types come from TypeScript (Volar pattern), reactivity comes from TC39 Signals. The grammar **converges JS, never collides with active TC39 proposals**.

The compiler maps Tu source to TS shadow files; tsserver does the type checking. The runtime is a tiny Signal + DOM glue layer. There is no virtual machine and no custom runtime — it's vanilla JS at runtime, with `Signal.State` / `Signal.Computed` cells as the only library-level primitive.

Mental model order when reading Tu:

1. **Top-level `let`** — module-private binding. Auto-binds to a `Signal.State` cell unless the value is a `() => …` lambda (then it's a plain const) or `computed(...)` (then `Signal.Computed`).
2. **Lambdas are components** — capitalized lambda → component callable as `Foo()` or `Foo() { children }`. Lowercase → HTML tag-call (in markup position) or plain function (in expression position).
3. **`{ … }` after a callee = children block** — the trailing-closure DSL. Each child is whitespace-separated; no `;` or `,` between children.
4. **Markup, props, and style live in one syntax**, top-to-bottom.

## File anatomy

```tu
// 1. Imports. Sources end in .tu (cross-Tu) or are bare (npm packages).
import { Fragment } from "@tu-lang/runtime"
import { Card } from "./Card.tu"

// 2. Type aliases (TS-style; raw RHS preserved to TS shadow).
type Point = { x: number; y: number }

// 3. Module-private cell (top-level `let` → Signal.State<number>).
let count = 0

// 4. Public cell (export → consumers can import the cell).
export let origin: Point = { x: 0, y: 0 }

// 5. Computed cell (re-derives when its read-cells mutate).
export let doubled = computed(count * 2)

// 6. Component (capitalized lambda; not wrapped in a Signal cell).
export let App = (children: Child[]) => .panel() {
  h1 { "count = " count " (doubled = " doubled ")" }
  button(onClick: () => count = count + 1) { "+1" }
  children

  style {
    .panel { font-family: system-ui, sans-serif; padding: 1rem; }
    .panel > h1 { color: #312e81; }
  }
}
```

## Bindings

### `let X = value`

Module-private.

- **Value is a primitive / object literal / array literal / `[…]` / call result** → `let X = …` compiles to `const X = new Signal.State(…)`.
- **Value is `(args) => body`** → plain `const X = (args) => body`. Not wrapped.
- **Value is `computed(expr)`** → `const X = new Signal.Computed(() => expr)`.

```tu
let count = 0                       // Signal.State<number>
let make = (n) => n * 2              // plain function, no cell
let doubled = computed(count * 2)    // Signal.Computed<number>
```

### `export let X = value`

Public — appears in the module's named exports. Same wrapping rules as bare `let`.

### Annotated bindings

```tu
let count: number = 0                // Signal.State<number>
let names: string[] = []             // Signal.State<string[]>
let snap: Point = { x: 0, y: 0 }     // Signal.State<Point>
let cell: Signal.State<MyT> = …      // user opts out of double-wrap; the
                                     // compiler honors a pre-wrapped Signal.* type
```

The annotation is a raw source slice (depth-tracked across `()`, `{}`, `[]`, `<…>`). The TS-mode emit threads it through verbatim; JS-mode strips it.

### Local `let` (inside a block)

```tu
let App = () => {
  let greeting = "Hello, " + name + "!"
  p { greeting }
}
```

A local `let` is a **plain const**, not a Signal cell. It exists for closures, derived values, and small locals. Block bodies with one or more `let`s compile to an IIFE.

## Type aliases

```tu
type Point = { x: number; y: number }
type RGB = readonly [number, number, number]
export type AppProps = { children: Child[] }
```

`type` is a contextual keyword (only triggers when followed by `Ident =` at statement boundary). The RHS is captured verbatim and emitted into the TS shadow. JS mode erases the entire alias.

## Values

### Literals

```tu
"a string"                  // StringLit (escapes: \n \t \r \" \\)
42                          // NumberLit (integers only at lexer level; decimals work via JS)
[1, 2, 3]                   // ArrayLit
[]                          // empty ArrayLit (Signal.State<any[]> auto-widened)
{ x: 1, y: 2 }              // ObjectLit
{ "data-id": 7 }            // ObjectLit with string key
{}                          // EMPTY OBJECT — not an empty block
```

`{` is disambiguated against the block form by lookahead: `{ }`, `{ Ident :`, or `{ String :` triggers an ObjectLit. Anything else (`{ x }`, `{ let y = 1; y }`, `{ tag(...) }`) stays a Block.

**Not yet supported** (don't emit these — see the [Deferred backlog](./DEFERRED)):

- Object shorthand: `{ x }` — write `{ x: x }`
- Computed keys: `{ [k]: v }`
- Spread: `{ ...rest }`, `[...arr]`

### Identifiers + member access

```tu
count                       // bare ident — reads the binding
origin.x                    // member access (postfix)
make(n).field               // member access on a call result
nested.outer.inner          // chained
```

Member access **only** works on value-yielding expressions — `Ident`, plain `CallExpr` (no children block), existing `MemberExpr`, `ObjectLit`, `ArrayLit`. It does **not** work after a `TagCall` / `IfExpr` / `Block` / lambda body. This rule prevents `div { x }\n.body() { y }` from re-parsing as `(div{x}).body(){y}`.

### Lambdas

```tu
(x) => x + 1
(x: number) => x + 1
(name: string, age: number) => p { name }
() => p { "hi" }
(x: number): string => "ok"               // return-type annotation
(): Map<string, { v: number }> => empty   // generics + nested types OK
```

Param types and return types are raw slices — preserved in TS mode, erased in JS mode. The body is any expression (including a Block, IfExpr, ForExpr, TagCall, ObjectLit, …).

### Calls

```tu
foo(arg, another)           // CallExpr — positional args
make({ x: 1 })              // arg can be any expression
```

Identifiers followed by `(` and positional args (no `Ident:` immediately inside) parse as call expressions. The result is whatever the function returns.

### Blocks

```tu
{
  someStmt
  anotherStmt
  finalExpr      // value of the block
}
```

Each item is parsed as an expression (or a `LocalLet`). The last non-LocalLet expression is the block's value. Multi-statement blocks compile to an IIFE; single-statement blocks compile to `(stmt)`. **Note: `{}` is an empty object literal, not an empty block** — write `{ undefined }` if you want a block that evaluates to `undefined`.

## Markup (tag-calls)

Trailing-closure DSL. **Capitalization is the discriminator** (mirrors React/JSX):

- **Lowercase identifier** → `h("tag", props, children)` — an HTML element.
- **Uppercase identifier** → `Callee(args, [children])` — a real component function call.

### Bare tag with children

```tu
div { "Hello" }                   → h("div", {}, ["Hello"])
h1 { "title" p { "body" } }       → h("h1", {}, ["title", h("p", {}, ["body"])])
```

Children are **whitespace-separated**, NOT comma-separated. Newlines / spaces between them are insignificant.

### Tag with named props

```tu
div(class: "card", id: "main") { … }
button(onClick: () => count = count + 1) { "+1" }
input(type: "text", value: name)
```

Props are `name: value` pairs separated by `,`. Values can be any expression — strings, idents (cell reads inject `.get()`), lambdas, ObjectLits, ClassRefs, etc.

### Component invocation

```tu
Card("title")                     → Card("title")
Card("title") { p { "body" } }    → Card("title", [h("p", {}, ["body"])])
Card { p { "no args, just kids" } }  → Card([h("p", {}, ["no args, just kids"])])
```

Components are real functions. tsserver sees them as such — hover, goto-definition, and rename all work cross-`.tu`. The trailing children block becomes the **last positional argument**, conventionally typed as `(children: Child[])`.

### Fragment (multi-root return)

```tu
import { Fragment } from "@tu-lang/runtime"

let App = () => Fragment {
  header { … }
  main { … }
  footer { … }
}
```

`Fragment` is a built-in helper that takes the children array and returns it as-is, letting a component return multiple sibling vnodes without an enclosing wrapper.

### Pug-style class shorthand

```tu
.card                             // ClassRef (used as a value, e.g. class: .card)
.card.elevated                    // multi-class binding
.card() { "x" }                   → div(class: "card …") { "x" }
.card.elevated() { "x" }          → div(class: "card elevated …") { "x" }
.card(tag: "section") { "x" }     // override default tag with a string literal
```

Pug-shorthand desugars to a `div` (or the `tag:` override) with the listed classes injected. An explicit `class:` prop in shorthand-position is a parse error — the shorthand already binds class.

### Children types

A child can be: TagCall, CallExpr, BinaryExpr, StringLit, NumberLit, Ident, IfExpr, ForExpr, StyleBlock, ClassRef, ArrayLit, ObjectLit, MemberExpr.

A child **cannot** be: Lambda, Block, AssignExpr (these throw at parse time).

## Control flow

### `if` / `else`

```tu
if (count > 0) { p { "positive: " count } }
else if (count == 0) { p { "zero" } }
else { p { "negative" } }
```

The condition is parenthesized; both branches are blocks. Else-if chains are supported as nested IfExpr. `if` is an expression — its value is the chosen branch's block-value.

### `for`

```tu
for item in items {
  li { item }
}
```

Compiles roughly to `Array.from(items, (item) => …)`. The iterable's tail `{ … }` is the loop body, **not** a tag-call on the iterable (the parser suppresses brace-block parsing inside the iter expression for exactly this reason).

## Reactivity

- Top-level `let X = …` (non-lambda, non-`computed(…)`) → `Signal.State<T>`. Reads of `X` inside any expression context emit as `X.get()`. Assignments `X = expr` desugar to `X.set(expr)`.
- `let X = computed(expr)` → `Signal.Computed<T>` whose body re-runs whenever any cell read inside `expr` mutates.
- **Local `let`** (inside a block) is a plain const; reads/writes pass through unchanged.
- **Lambda params** are plain idents (no `.get()` injection).
- `mount(thunk, container)` re-runs `thunk` whenever any cell it reads mutates.
- `computed(...)` cells lazily re-evaluate on read after invalidation.

The `.get()` injection rule: a bare ident emits as `name.get()` if and only if `name` resolves to a top-level state or computed cell **and** is not shadowed by a local `let`, lambda param, or `for` binder.

## Style block

```tu
let Card = (title: string) => .card() {
  h1(class: .card__title) { title }
  p { "body" }

  style {
    .card { padding: 1rem; border-radius: 8px; }
    .card__title { font-size: 1.25rem; }
    :global(.legacy) { color: gray; }   // unscoped escape hatch
  }
}
```

- `style { … }` is a special form (no parens). The body is raw CSS, preserved verbatim in the StyleBlock AST and emitted as a `<style>` sibling vnode.
- **Top-level CSS rules must be class-rooted** (M5/D). `body { … }` or `* { … }` at the top level is a compile error. Nested rules (`.card > h1 { … }`) are fine.
- **Scoped classes** (M5/F dual-class injection): every `ClassRef` in the markup gets BOTH the original name AND a per-component hashed name (`<div class="card card-tu-XXX">`). The CSS rewriter rewrites the selector to the hashed form (`.card-tu-XXX { … }`). Global selectors / dev-tools targeting `.card` still work, but `.card`'s rules don't bleed across components.
- **`:global(.foo)`**: escape hatch — selectors inside this wrapper stay unhashed.

### ClassRef syntax

```tu
.card                             // bare ClassRef — used as a value
class: .card                      // assigned to the class prop
class: .card.elevated             // multi-class space-joined
.card() { … }                     // pug-shorthand (see above)
```

A `ClassRef` to an **undeclared** class (one not declared in the enclosing component's `style { … }` block) is a compile error.

## Imports / exports

### Named import

```tu
import { Card } from "./Card.tu"        // cross-.tu (sibling)
import { Fragment } from "@tu-lang/runtime"  // npm package
```

V1 supports named imports only. No default imports, no namespace imports.

### Re-export

```tu
export { Card } from "./Card.tu"
```

### Cross-`.tu` reactivity

When you import a state/computed cell from another `.tu`, the importer's codegen knows to inject `.get()` on reads. The compiler analyzes the imported module's AST to classify each export's CellKind.

## Common gotchas (study these — they prevent bugs)

1. **`{}` is an empty OBJECT, not an empty block.** Write `{ undefined }` for an empty block.
2. **Children are whitespace-separated.** Don't write `,` between them: `div { x, y }` parses as `div { (x, y) }` which is not what you want.
3. **No shorthand object props yet.** `{ x }` is a Block, not `{ x: x }`. Write the key explicitly.
4. **No spread / computed keys / member access via `[]`.** Use object literal + member access via `.` only.
5. **`.foo()` after a sibling expression is NOT a method call.** It's pug-shorthand for the next element. `tag1 { x }\n.foo() { y }` parses as two siblings, not one chained call. (Member access `obj.foo` only applies to value-yielding exprs.)
6. **Capitalized names are components, lowercase are HTML tags.** `Card { … }` and `card { … }` parse to entirely different things.
7. **Style block top-level rules must be class-rooted.** No `body`, `*`, `:root` at the top level (use `:global(...)` if you really need them).
8. **An explicit `class:` prop inside a pug-shorthand is an error.** The shorthand already binds class.
9. **No `match` / pattern matching.** Removed in M1.11 due to TC39 Pattern Matching collision. Use chained `if / else if / else`.
10. **No `function` keyword anywhere.** All functions are arrow-style `(args) => body`.
11. **No `class` keyword for OOP.** Tu is immutable-by-default; user-defined types are functions, not classes.
12. **No member access through `()` chained results.** `make(n).x` works; `Card("hi") { … }.x` does not (the second is a vnode, not a value).

## Compilation model (high-level)

Each `.tu` file compiles to a single `.js` (or `.ts` shadow) module. The compiler:

1. **Tokenizes** the source (lexer in `packages/compiler/src/lexer.ts`).
2. **Parses** to AST (`parser.ts`). All AST nodes carry `start` / `end` byte offsets for source maps + LSP.
3. **Analyzes** scoped components: every `let X = (...) => …` whose body uses `ClassRef`s gets a per-component hash (FNV-1a over name + style-body). Declared classes are extracted from the style block's CSS via a regex scanner.
4. **Generates** JS/TS via a streaming buffer that records `TokenMapping`s as it emits. Top-level lets become `const X = new Signal.State(…)` / `Signal.Computed(…)` / plain const based on classification. Tag-calls become `h("tag", props, children)`. Component calls stay as real function calls. Pug-shorthand desugars in the AST. ClassRefs emit hashed class strings. Style blocks emit as `<style>` vnode children with the CSS rewritten.
5. **Source maps** are V3, per-token + per-statement.

The runtime is `@tu-lang/runtime` — `h(tag, props, children)`, `mount(thunk, container)`, `hydrate(thunk, container)`, `renderToString(node)`, `Fragment(children)`, `Signal.State`, `Signal.Computed`. Mount drives a keyed diff (LIS-based reorder, focus / scroll / `<input>` value preserved).

## Testing pattern

Per-package tests live in `packages/<name>/tests/`. Compiler tests:

```ts
// packages/compiler/tests/parser.test.ts
import { describe, expect, it } from 'vitest'
import { tokenize } from '../src/lexer.js'
import { parse } from '../src/parser.js'

function ast(src: string) { return parse(tokenize(src), src) }

describe('parser', () => {
  it('parses an export let with object literal', () => {
    const tree = ast('export let p = { x: 1 }')
    expect(tree.body[0]).toMatchObject({
      kind: 'LetDecl',
      exported: true,
      name: 'p',
      value: { kind: 'ObjectLit', properties: [{ key: 'x' }] },
    })
  })
})
```

Codegen tests assert on the emitted JS string. Integration tests (`tests/integration.test.ts`) compile a Tu source, write the result to a temp `.mjs`, dynamic-import it, and exercise the exported cells/components against `renderToString` / `mount`.

## Deferred features (do NOT emit these)

See the full list at [DEFERRED.md](./DEFERRED). Quick exclusions:

- `match` / pattern matching — removed in M1.11.
- Object shorthand `{ x }` / spread `{ ...r }` / computed keys `{ [k]: v }`.
- Array spread `[...arr]`.
- Indexed access `obj["key"]` or `arr[i]`.
- Method calls `obj.foo()` (works only when `foo` is a real function field; no protocol/method overloading).
- Default exports.
- `async` / `await` syntax (no async story yet).
- Per-component HMR.
- Static-HTML subtree optimization (post-M5).

When unsure: **stick to the constructs documented above**. The language deliberately surfaces a small, opinionated set; if a JS-side feature isn't listed here, it probably isn't in V1.

## Quick reference: emit shapes

| Tu | JS emit |
|---|---|
| `let count = 0` | `const count = new Signal.State(0)` |
| `let App = () => …` | `const App = () => …` (plain) |
| `let d = computed(c * 2)` | `const d = new Signal.Computed(() => (c.get() * 2))` |
| `count = count + 1` | `count.set(count.get() + 1)` |
| `div { x }` | `h("div", {}, [x.get()])` |
| `Card("hi") { p { y } }` | `Card("hi", [h("p", {}, [y.get()])])` |
| `.card() { x }` | `h("div", { class: "card card-tu-XXX" }, [x.get()])` |
| `{ x: 1, y: 2 }` | `{ x: 1, y: 2 }` |
| `obj.x` (cell) | `obj.get().x` |
| `obj.x` (param/local) | `obj.x` |
| `for x in xs { … }` | `Array.from(xs.get(), (x) => …)` |

## Related resources

- [Language reference](./LANGUAGE) — every Tu syntactic form with examples and emit shapes.
- [Deferred backlog](./DEFERRED) — every "leave for later" decision, indexed by milestone.
- [GitHub repository](https://github.com/mowtwo/tu) — source, examples, playground.
- [llms.txt](./llms.txt) — plain-text mirror of this skill for direct fetch.

---

*Tu is pre-alpha (`0.1.0-alpha.6` on npm). This skill reflects the language as of 2026-05-01 (M6.2 + tu-xing + tu-shu shipped; obj.x member access and obj.method() method calls both supported). When in doubt, read [LANGUAGE.md](./LANGUAGE) for the canonical reference, and check the [git log](https://github.com/mowtwo/tu/commits/main) for the latest changes.*
