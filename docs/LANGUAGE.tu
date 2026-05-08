// Generated from docs/LANGUAGE.md — Tu-native docs page.

export let frontmatter = {}

export let Page = () => div {
  markdown {
    # Tu Language Reference

    A practical reference for every Tu syntactic form that compiles today. Covers
    the current pre-alpha line (`0.1.0-alpha.8`): async / Suspense / streaming
    SSR, runtime type metadata, structured Exceptions, filtered catches,
    Tu-native router, and the shared LSP path used by VS Code and the playground.
    See [DEFERRED](./DEFERRED) for work still in flight.

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
    - `interface X { … }` / `export interface X { … }` — object shape
    - `type X = …` / `export type X = …` — erased alias for non-object unions/tuples
    - `enum X { … }` / `export enum X { … }` — frozen value object + TS value-union type
    - `Exception X { … }` / `export Exception X { … }` — Error-compatible factory + runtime descriptor
    - `import { … } from "./other.tu"` — named import
    - `import X from "./other.tu"` — default import
    - `export { … } from "./other.tu"` — named re-export

    Comments use `//` (line) — there is no block-comment form yet.

    ```tu
    // A complete file:
    import { Card } from "./Card.tu"

    export let count = 0

    export interface Pair { x: number, y: number }

    export let App = () => div { Card(title: "hi") }
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
    let { a, b } = source                    // two state cells: a, b
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

    ### Module-scope destructuring

    `let { a, b } = source` is a flat object destructure at the top level.
    The RHS evaluates once, then each field becomes its own state cell. Reads
    use normal `.get()` injection. MVP scope is private bindings only: no
    `export let { … }`, nested patterns, renames, defaults, or arrays.

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

    ## Interfaces and aliases

    ```tu
    interface Pair { x: number, y: number }
    type RGB = readonly [number, number, number]
    export enum Color { Red = "red", Green = "green", Blue = "blue" }
    ```

    Use `enum` when the values are meaningful at runtime (`Color.Red`) and a
    type annotation should accept those values. Use `interface` for object
    shapes. Type aliases still work for tuples and ad hoc unions; they erase
    entirely from JS-mode output.

    `type` is a contextual keyword: it triggers only when followed by `Ident =`
    at statement boundary. So a lambda param named `type` still works:

    ```tu
    export let f = (type: string) => p { type }
    ```

    ---

    ## Enums

    ```tu
    export enum Tone {
      Neutral
      Accent = "accent"
      Danger = 3
    }
    ```

    Enums emit a frozen runtime object and, in TS shadow output, a like-named
    value-union type. Use `Tone.Accent` at runtime and `tone: Tone` in
    annotations. Omitted member values default to the member name as a string.

    ---

    ## Exceptions and runtime type metadata

    ```tu
    import { type } from "@tu-lang/std"

    interface User { id: number; name: string }
    Exception ValidationError { field: string }

    let parseUser = (raw: unknown): User ? ValidationError => {
      if (type.is(raw, User)) { raw }
      else { throw ValidationError("Invalid user", { field: "user" }) }
    }

    let label = (raw: unknown) => try {
      parseUser(raw).name
    } catch if ValidationError as e {
      "ValidationError on " + e.field + ": " + e.message
    } catch e {
      "Error: " + e.message
    }
    ```

    Interfaces and Exceptions emit runtime descriptors in addition to TS shadow
    types. `type.is(value, User)` is a structural runtime check and a TS/LSP type
    predicate, so values narrow inside guarded blocks. Anonymous object shapes
    that exactly match a nearby named interface are reused in editor hovers when
    possible.

    `Exception Name { field: T }` emits an Error-compatible factory. The first
    argument is always the default `message: string`; the optional second object
    supplies custom fields. A lambda may declare possible structured throws with
    `(): Result ? ValidationError | NotFoundError`. The throws clause is
    documentation and LSP signal; JS output still uses normal `throw`.

    Prefer filtered catches:

    ```tu
    catch if ValidationError as e { e.field }
    catch e { e.message }
    ```

    The fallback `catch e` binding defaults to an Error-like base type with
    `message: string`. Legacy `catch (e: T)` remains accepted for compatibility,
    but new code should use `catch if T as e`.

    ---

    ## Values

    ### Literals

    ```tu
    "a string"           // StringLit
    42                   // NumberLit
    [1, 2, 3]            // ArrayLit
    []                   // empty ArrayLit
    { x: 1, y: 2 }       // ObjectLit
    { "data-id": 7 }     // ObjectLit with string key
    {}                   // empty ObjectLit
    ```

    Strings support common escapes: `\n`, `\t`, `\r`, `\"`, `\\`. Numbers are
    integers only at the syntactic level (decimal-point parsing not in V1).

    `{ … }` is disambiguated against the block form (see [Blocks](#blocks)):
    an opener of `{ }`, `{ Ident :`, `{ String :`, `{ [expr] :`, or
    `{ ...expr }` parses as an object literal. Anything else (`{ x }`,
    `{ let y = 1; y }`, `{ tag(...) }`) stays a Block. Shorthand
    (`{ x }` → `{ x: x }`) is still not recognized; write the key explicitly.

    When an object literal appears immediately after `=>` in a lambda body, the
    codegen wraps it in parens (`() => ({ x: 1 })`) so JS doesn't read it as a
    block.

    ### Modern JS expression forms

    ```tu
    `Hello ${name}`                   // template literal
    user?.profile?.name ?? "Guest"    // optional chaining + nullish coalesce
    items[index]                      // indexed access
    { [field]: value, ...base }       // computed key + object spread
    [...items, next]                  // array spread
    total += 1                        // compound assignment
    await loadUser(id)                // async expressions
    import("./Plugin.tu")             // dynamic import
    ```

    Tu supports these JS expression forms where they preserve Tu's grammar
    shape. `instanceof` is intentionally banned; use `type.is(value, T)`.

    ### Identifiers

    A bare identifier reads the binding by that name. Resolution follows
    JS-style lexical scope (lambda params, `for` binders, then top-level lets).

    ### Member access

    ```tu
    obj.x
    make(n).field
    nested.outer.inner
    ```

    Postfix `.Ident` reads a property from any expression that yields a value.
    The `.` here doesn't collide with the prefix-dot ClassRef syntax —
    `class: .card` keeps its existing meaning because the dot sits at
    expression *head*, not after a returned value. Cell reads inject `.get()`
    on the leaf ident only: `origin.x` compiles to `origin.get().x` when
    `origin` is a state cell.

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
    (x: number): string => "ok"               // return-type annotation
    (): Map<string, { v: number }> => empty   // generics + nested types OK
    ```

    The body is any expression (including a Block). Param and return type
    annotations preserve through TS-mode emission for inference. JS-mode
    strips both.

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
    A 1-statement block compiles to `(stmt)`. Note that `{}` parses as an
    empty **object literal**, not an empty block — write a one-statement block
    explicitly (e.g. `{ null }`) if you really mean "evaluate to an
    intentional empty value."

    ---

    ## Markup (tag-calls)

    Markup uses a trailing-closure DSL. **Capitalization is the
    discriminator between HTML tags and user components** (React/JSX
    convention):

    - **Lowercase** identifier → `h("tag", props, children)` (HTML element)
    - **Uppercase** identifier → `Callee(props)` (component function call).
      tsserver sees the call as a real function — hover, goto-definition,
      and completion all work on the component name.

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

    Components use named props. Legacy positional calls still compile during
    the alpha cycle, but the LSP and `tu check` warn so code can migrate
    before removal.

    **1. Named-arg form** — props delivered as a single object, like HTML:

    ```tu
    let App = () => Card(title: "Alice", footer: "© 2026") {
      p { "Body content" }
    }
    ```

    The receiver gets a single `props` arg; trailing children block is
    auto-merged in as `props.children`:

    ```tu
    let Card = (props) => .card() {
      h2 { props.title }
      props.children
      if (props.footer) { footer { props.footer } }
    }
    ```

    All props are optional by construction — call `Card()`, `Card(title:
    "x")`, or `Card(title: "x") { p { "body" } }` all work.

    **Legacy positional form** — deprecated M5.x shape. Calls like
    `Card("Alice") { ... }` still emit unchanged for backward compatibility,
    but editor and `tu check` diagnostics point at `Card` and ask for named
    props. The parser
    disambiguates by peeking the first token after `(`: an `Ident :` opener
    triggers named-arg; anything else stays positional.

    `children` is an array of children that the runtime's flatten step
    splices into the parent's children list at render time. **Use `Child[]`
    (not `VNode[]`)** for the type — `Child = VNode | string | number | null
    | undefined | Child[]` reflects the runtime contract, and a component
    body that ends in a `style` block returns an array fragment, which
    `VNode[]` would reject. Both `Child` and `VNode` are auto-imported from
    `@tu-lang/runtime` in TS-mode emit, so the annotation resolves without an
    explicit user import.

    ### Fragment

    `Fragment { … }` from `@tu-lang/runtime` lets a component return multiple
    sibling vnodes without an enclosing wrapper element (React's `<>…</>`):

    ```tu
    import { Fragment } from "@tu-lang/runtime"

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

    `if` is an expression. `else` is optional; a missing branch renders as no
    child. Use `else { null }` when you want the empty case to be explicit.
    Else-if chains stay flat.

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

    ### `try` / `catch` / `finally`

    ```tu
    try {
      risky()
    } catch if ValidationError as e {
      e.field
    } catch e {
      e.message
    } finally {
      cleanup()
    }
    ```

    `try` is an expression. Filtered catches lower to a single JS catch with
    `type.is` dispatch, and the LSP narrows the bound error inside each branch.
    Use `throw SomeException("message", { field: "x" })` for Tu Exceptions or
    normal JS `Error` values for fallback errors.

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

    `mount(thunk, container)` from `@tu-lang/dom` wires a thunk into the DOM
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

    ## Markdown block (M6.3)

    `markdown { … }` is a special-form block — sibling shape to `style { … }` —
    that lets Tu source mix prose alongside markup. The body is raw markdown;
    the compiler runs it through markdown-it at build time and emits the
    result as a single static-HTML vnode (M6.0 path), so there's no markdown
    parser at runtime.

    ```tu
    let About = () => .page() {
      h1 { "About" }
      markdown {
        Tu is a **reactive UI language** built around the trailing-closure
        DSL pattern. See the [language reference](/LANGUAGE) for the full
        syntax map.

        - One bullet
        - Another bullet

        \`\`\`ts
        const x: number = 42
        \`\`\`
      }

      style { .page { padding: 1rem; } }
    }
    ```

    Notes:

    - The block body is dedented before parsing so 4-space indents from
      surrounding Tu source don't trip CommonMark's "indented = code block"
      rule.
    - Brace-balanced lexing: `{` and `}` characters inside the markdown body
      must come in matching pairs; backtick-fenced code blocks (```` ``` ````)
      and inline backticks are skipped over so braces inside code don't
      unbalance the count.
    - The output is wrapped in `<article class="tu-markdown">` so consumers
      can style the prose container with one selector.
    - No interpolation in V1 — the markdown body is purely literal. Mixing
      Tu cells into prose comes later (likely via a `${expr}` form that
      splits the block into static + dynamic spans).

    ---

    ## Runtime + platform packages

    Tu's runtime is split into two packages so a `.tu` file that doesn't intend to run in a browser can never accidentally pull DOM impls (M6.10):

    - **`@tu-lang/runtime`** — the *universal* half. `Signal`, `h`, `Fragment`, `VNode`, `Child`, `renderToString`, `renderPage`, `renderPageHtml`, `renderToStringAsync`, `renderPageAsync`, `renderToStream`, `Suspense`, `TuRenderError`. Compiled Tu auto-imports `Signal` / `h` / `Fragment` from here. Safe to use from Node, edge runtimes, Cloudflare Workers — anywhere without a `document`.
    - **`@tu-lang/dom`** — the *browser* half. `mount`, `hydrate`, `defineCustomElement`, plus typed re-exports of the standard DOM types your Tu code touches (`Event`, `MouseEvent`, `HTMLInputElement`, `Node`, `Element`, `RequestInit`, `AbortController`, …). Anything that touches `document` lives behind an explicit `import { … } from "@tu-lang/dom"`.
    - **`@tu-lang/router`** — the DOM-free route layer. `createRouter` handles static, `:param`, and `*splat` patterns with deployment base stripping; `renderRoute`, `renderRouteToString`, and `renderRouteToStream` connect matched handlers to the SSR runtime.

    Typical browser entry:

    ```tu
    import { mount } from "@tu-lang/dom"
    import { App } from "./App.tu"

    mount(() => App(), document.getElementById("app"))
    ```

    Typical SSR entry:

    ```tu
    import { renderPageAsync } from "@tu-lang/runtime"
    import { Page } from "./Page.tu"

    let html = await renderPageAsync(() => Page(), { title: "Hi" })
    ```

    Typical routed SSR entry:

    ```ts
    import { createRouter, renderRoute } from "@tu-lang/router"

    const router = createRouter([{ path: "/users/:id", handler: ({ params }) => User({ id: params.id }) }])
    const html = await renderRoute(router, "/users/alice", { title: "User" })
    ```

    The split is enforced at the *runtime-function* layer today. Strict type-level isolation (dropping `lib.dom` from the LSP shadow so unused DOM globals can't sneak in) is tracked in DEFERRED.

    ## External JS escape hatch (M6.9 / M6.10.1)

    For interop with browser APIs, third-party JS, or anything outside Tu's grammar, declare a typed bridge with `external JS`:

    ```tu
    let inputValueOf = external JS (e: Event): string {
      const t = e.target
      return t && 'value' in t ? String(t.value) : ''
    }

    let App = () =>
      input(onInput: (e: Event) => state = inputValueOf(e))
    ```

    The block body is raw JavaScript — Tu doesn't parse it, just emits it verbatim into the compiled module. The signature `(e: Event): string` is a regular Tu type annotation and propagates into the TS shadow, so call sites get full type checking without Tu having to understand the body.

    Use cases:

    - DOM-level extraction that needs a cast Tu doesn't have yet (`event.target` → `HTMLInputElement.value`).
    - Native browser APIs not surfaced through `@tu-lang/dom` (`URL`, `crypto.subtle`, `IntersectionObserver`, …).
    - Interop with non-Tu npm packages whose shape Tu's TypeScript emit doesn't import-friendly.
    - Performance escape hatches where you want to drop into hand-written JS without leaving the file.

    Inline object-shape return types are supported (M6.10.1):

    ```tu
    let measure = external JS (xs: any[]): { ms: number; out: any[] } {
      const t0 = performance.now()
      const out = xs.slice().sort()
      return { ms: performance.now() - t0, out }
    }
    ```

    The `{` after `:` is parsed as a type literal, not a body opener — the parser disambiguates by the immediately-preceding token.

    ---

    ## Imports / exports

    ### Named import

    ```tu
    import { Card, Header } from "./Card.tu"
    import App from "./App.tu"
    ```

    Relative `.tu` paths are resolved by the compiler. Named and default
    imports map to standard ESM `import` in the JS output (and `.ts` extension
    in the TS shadow so tsserver resolves the sibling shadow file).

    ### Re-export

    ```tu
    export { Card } from "./Card.tu"
    ```

    Same as `import { Card }` followed by `export { Card }`, but in one
    statement and without binding `Card` locally.

    ### Cross-`.tu` reactivity (M2.3)

    When the LSP, `tu check`, or the `@tu-lang/vite` plugin compile a graph of
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
    interfaces with typed runtime descriptors, `Exception` factories, `type X = …`
    aliases, and (for exported lambdas with all-typed params) a synthesized
    `interface ${Name}Props { … }`.

    `tu check <file>` runs the shadow through tsserver and pretty-prints
    diagnostics back at the `.tu` source. The `@tu-lang/lsp` package exposes the
    same logic plus hover, completion, definition, and rename — all token-
    ranged so squiggles / underlines target individual identifiers.

    `.d.ts` emission via `tsc --emitDeclarationOnly` over the shadow gives
    downstream TS consumers a clean declaration file with only the public
    `export let` / `export type` surface.

    ---

    ## What's not in V1

    See [DEFERRED](./DEFERRED) for the live list. As of M9 the notable gaps are:

    - **Generic syntax on Tu declarations** — `interface Box<T>` and generic
      component declarations remain deferred.
    - **Lifecycle hooks + element ref sugar** — no `onMount` / `onUnmount`; no Vue-2-style explicit `ref`.
    - **File-based app router** — `@tu-lang/router` provides route matching and SSR helpers; Next.js-style `app/[slug]/page.tu` discovery, layouts, loaders, and server functions remain deferred.
    - **Per-component fine-grained HMR** — full module re-import on save.
    - **Local reactivity** — full thunk re-runs on cell mutation; per-binding
      patches are deeper rework.
    - **Style ↔ JS state interop** — design pending; cells don't auto-bind to CSS variables yet.
    - **Qwik-style resumability** — hydrate re-runs the first-frame thunk; serialized listener references are future work.

    ## Recent landed features

    - **Tu-native `@tu-lang/router`** — static, dynamic (`:id`), and catch-all
      (`*slug`) matching; deployment-base stripping; query parsing; fallback
      handlers; and SSR helpers. The playground now uses shareable URLs such as
      `/tu/playground/types`.
    - **Shared browser/workspace LSP** — VS Code and the live playground editor
      use the same `@tu-lang/lsp` shadow-graph implementation for diagnostics,
      hover, completion, definition, references, and rename.
    - **Runtime type metadata** — `interface` and `Exception` declarations emit
      descriptors consumed by `type.of`, `type.is`, `type.as`, and `type.tryFrom`.
      `type.is` narrows in editor hovers and TS diagnostics.
    - **Filtered catch narrowing** — `catch if ValidationError as e` narrows `e`
      to the matching Exception, and `catch e` falls back to an Error-like base.
    - **Modern JS expression compatibility** — template literals, optional
      chaining, nullish coalescing, indexed access, spread, computed object keys,
      dynamic import, async/await, compound assignment, exponentiation, and
      bitwise operators are supported.

    ## What landed in M6.11 (async + SSR)

    - **`renderToStringAsync(node)`** — awaits any `Promise` child during the SSR walk. `Child` gained a `Promise<Child>` member; sync `renderToString` now throws `TuRenderError` on Promise children (was silently emitting `[object Promise]`).
    - **`renderPageAsync(thunk, options)`** — thunk may be a sync function or an async lambda; the body is rendered via `renderToStringAsync` and assembled into a complete HTML document.
    - **`Suspense({ fallback, children })`** — boundary primitive that catches Promise rejections inside its body and emits the `fallback` Child instead. Boundaries compose; sync `renderToString` of a Suspense renders fallback verbatim. Tu call-site is named-arg form: `Suspense(fallback: div { "Loading…" }) { AsyncChild() }`.
    - **`renderToStream(thunk, options)`** — Web `ReadableStream<Uint8Array>` ready to pipe into a `Response`. Shell + sync body + per-boundary `<div data-tu-suspense="N">…fallback…</div>` placeholders flush first; resolved bodies stream later as `<template id="S:N">…</template><script>$tu_replace("N")</script>` chunks in resolution order. Rejected boundaries leave the placeholder (with its fallback content) in place.

    Examples:
    - `examples/ssr/` — sync `renderToString` + client-side `hydrate` round-trip.
    - `examples/suspense/` — async + Suspense + streaming, both pipelines exercised end-to-end.

    See `docs/SSR-ASYNC-DESIGN.md` for the design context behind these primitives.

  }
}
