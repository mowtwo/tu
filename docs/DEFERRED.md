# Deferred work — Tu

A living list of every "leave for later" decision made during a milestone, with the milestone that introduced the gap and (when known) where it should land. Rows are removed in the commit that fills them, so the diff shows the loop closing.

## Open

| Item | Introduced | Target | Notes |
|---|---|---|---|
| CSS4 nesting / `@layer` / `@scope` awareness in style block | M1.4 | M1.9+ | M1.8 ships a regex-style class scanner that handles flat selectors and most nested rules correctly (the regex matches `.foo` anywhere, including inside nested blocks). Edge cases like `:is()`, `@scope`, and selector lists need a real CSS parser. |
| `:global(.foo)` escape hatch for unscoped selectors | M1.8 | M1.9+ | Today every `.identifier` selector inside a scoped component's style block gets hashed. There's no way to opt a single selector out — needs a `:global(...)` wrapper or similar. |
| Multi-class pug shorthand `.foo.bar()` | M1.8 | post-M1.8 | M1.8 V1 only supports a single class in the shorthand. |
| Pug-shorthand tag override `.foo(tag: "section")` | M1.8 | post-M1.8 | M1.8 V1 always desugars to `div`. |
| Per-component fine-grained HMR boundaries | M1.6 | post-M1.7 | The `@tu/vite` plugin currently triggers a full module re-import + re-mount on `.tu` save. Per-component preserve-state HMR is future work. |
| Counter.tu and Todo.tu need their own buttons (currently the playground chrome supplies them) | M1.6 | when adding event-handler-rich examples | The .tu source in those examples has no `onClick` — playground main.js wires controls externally. Better demo when the `.tu` itself owns the buttons. |
| Token-level (vs per-statement) source maps | M1.9 | post-M2 | M1.9 ships per-top-level-statement mappings — enough to point browser stack traces at the right `.tu` block, not at the right column inside it. Per-token mappings need a stateful emit pipeline; deferred until codegen is refactored to one. |
| Local reactivity (per-cell-read subscriptions) | M1.7 | M2+ | Keyed diff is cheap, but the component thunk still re-runs in full on every cell mutation. Solid-style per-binding patches that only touch the affected text node / attribute are a deeper rework — needs a different compiler IR that wraps each cell read in its own reactive scope. |
| LIS-based move minimization in keyed reorder | M1.7 | post-M1.7 | Current `patchChildren` uses a simple "walk forward, insertBefore as needed" pass — correct, but moves more nodes than strictly necessary on long-range reorders. Replace with longest-increasing-subsequence to skip in-place items. |
| Suspense / async components | M1.7 | M2+ | No async story yet. |
| Imported names are always classified as functions in codegen | M2.1 | M3 (LSP / type-aware) | Codegen has no way to tell whether an imported name is a function, a Signal cell, or a plain value, so it defaults to "function" (emits as plain ident, no `.get()` injection). Importing a Signal cell directly therefore breaks reactivity at the use site. Workaround: in the source module, export a getter (`export let getCount = () => count.get()`) instead of the cell. Real fix needs the M3 type-aware emit pass. |
| Default export (`export default …`) | M1.10 | TBD | Tu's no-`function`-keyword aesthetic argues against it; revisit when component-as-file becomes idiomatic. |
| Type vs value namespace | M1.10 | when `type X = …` lands | M2 V1 ships without user-facing type aliases, so the namespace question doesn't bite yet. Revisit when adding TS-style `type` declarations to Tu's surface. |
| Synthesize component-prop interfaces in TS emit | M2 | M3 / LSP polish | M2 V1 lets tsserver INFER prop types from the lambda body. For richer IDE hover ("CardProps { title: string; body: string }") synthesize an explicit interface per exported component lambda. |
| Synthesize style-class literal-type union in TS emit | M2 | M3 / LSP polish | Today the codegen rejects undeclared `.classRef` at compile time (M1.8). For IDE completion of `.foo` against the declared set, emit a `type ClassesOf_X = "card" \| "card__title"` and type the `class:` prop accordingly. |
| Annotated `let X: type = …` declarations | M2 | when needed | Tu currently has lambda-param annotations only. Adding type annotations on let-decls lets users override TS inference (rare but useful for opaque cells). |
| `tu check` CLI command | M2 | M3 | The `examples/clicker/typecheck.mjs` script proves the recipe; lift into `@tu/cli` so `tu check` works on any `.tu` file or project. |
| Static-HTML optimization (skip h() for non-reactive subtrees) | M1.0 | post-M2 | User-flagged 2026-04-30. Detect markup subtrees that don't read any cell or parameter and emit them as `<template>`-cloned static HTML strings, like Svelte/Solid. Sizable perf + bundle win for typical UIs. |
| Style ↔ JS state interop (CSS variables auto-bound to cells) | M1.8 | post-M1.8 | User-flagged 2026-04-30. Want a syntax for declaring style values driven by Tu cells (probably CSS custom properties bound to Signal cells, surfaced as `var(--brand)` in CSS and `brand.set(...)` in JS). Pair with M1.8's scoping infrastructure. |

## Closed in M2.1

- ~~Cross-`.tu` `import { X } from "./other.tu"`~~ — landed: lexer + parser recognize `import { … } from "…"`, codegen emits the ESM line verbatim (and rewrites `.tu` → `.ts` in the TS shadow). Imported names are classified as `function` so reads emit as plain idents (no `.get()`). Verified end-to-end via examples/scoped split into 3 files (Scoped.tu imports RedCard.tu + BlueCard.tu) — real browser shows the two cards each with their own M1.8 hash.
- ~~`export { X } from "./other.tu"` re-exports~~ — landed alongside imports.
- ~~Cross-`.tu` `import` follow-through in TS shadow~~ — landed: `compileToTS` rewrites `.tu` source paths to `.ts` so tsserver resolves the sibling shadow.

## Closed in M2

- ~~Type system via TypeScript (Volar pattern) — V1~~ — landed: `compileToTS(source, options)` emits TypeScript with preserved lambda param type annotations. tsserver INFERS the rest from the existing JS shape (`new Signal.State(0)` → `Signal.State<number>`, lambdas → return-typed-from-body, etc.). The `.d.ts` emit (`tsc --emitDeclarationOnly` over the shadow) reflects M1.10's public-surface decisions exactly: only `export let` bindings appear. New rows above track the post-V1 polish (component-prop interfaces, style-class literal-type unions, annotated `let X: type`, `tu check` CLI, cross-`.tu` import follow-through).
- ~~mount() bug: stop() didn't clean up DOM~~ — the playground sidebar accumulated stale subtrees when switching demos. Fix landed in the runtime alongside M2: `stop()` now removes the mount's own DOM children (sibling DOM in the container is left untouched). Two new regression tests cover this.

## Closed in M1.11

- ~~Remove `match`~~ — landed: dropped TokenKind.Match + Underscore, MatchExpr / MatchArm / MatchPattern AST nodes, parser branches, codegen emit + AST walkers. examples/todo's pluralized label rewrites cleanly as a chained `if/else if/else`. The new `feedback_avoid_tc39_conflicts.md` rule (saved alongside this milestone) is now the gate for any future sugar — check TC39 stage-2/3 first.

## Closed in M1.10

- ~~Module visibility design (`export`/`pub`/default)~~ — landed: bare `let` is module-private, `export let` is public. Parser accepts an optional `export` prefix on let-decls; codegen continues to honor the `exported` flag. New rows above track the still-open module work (cross-`.tu` import, re-exports, default export, type namespace).

## Closed in M1.9

- ~~Source maps from compiled JS back to `.tu` source~~ — V3 source map (per-top-level-statement) emitted both as inline data-URL footer and as the `map` field returned by `compileWithMap` / the `@tu/vite` `load` hook. Token-level granularity tracked as a new row above.
- ~~Better error messages with source location + caret~~ — `formatError` helper used by lexer + parser produces `file:line:col` plus a 3-line code-frame caret. Threaded via `compile(src, { filename })` and through `@tu/vite` so Vite's overlay shows the formatted message.

## Closed in M1.8

These rows tracked the pre-M1.8 scoping gap; M1.8 fills them and they are removed from Open. Kept here briefly so the closure shows in commit diffs:

- ~~Style scoping (auto class hash or `[data-tu-…]` attribute rewrite)~~ — landed via per-component FNV-1a hash + CSS rewrite
- ~~Symbolic class ref `.card` + pug-style `.card() {…}` shorthand~~ — landed
- ~~`let style = …` user variable name conflicts with `style { … }` block~~ — verified safe in current lexer (no `{` after `style`-as-RHS triggers CSS mode); covered by behaviour rather than syntax change
