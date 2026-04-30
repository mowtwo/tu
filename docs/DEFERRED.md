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
| Source maps from compiled JS back to `.tu` source | M1.0 | M2/M3 | Vite's default sourcemap covers JS-as-served, but error stacks point at the generated JS, not the original `.tu` lines. |
| Better error messages with source location + caret | M1.0 | M2/M3 | Lexer/parser throw `SyntaxError` with offset numbers; users want line:col + a code frame. |
| Counter.tu and Todo.tu need their own buttons (currently the playground chrome supplies them) | M1.6 | when adding event-handler-rich examples | The .tu source in those examples has no `onClick` — playground main.js wires controls externally. Better demo when the `.tu` itself owns the buttons. |
| Local reactivity (per-cell-read subscriptions) | M1.7 | M2+ | Keyed diff is cheap, but the component thunk still re-runs in full on every cell mutation. Solid-style per-binding patches that only touch the affected text node / attribute are a deeper rework — needs a different compiler IR that wraps each cell read in its own reactive scope. |
| LIS-based move minimization in keyed reorder | M1.7 | post-M1.7 | Current `patchChildren` uses a simple "walk forward, insertBefore as needed" pass — correct, but moves more nodes than strictly necessary on long-range reorders. Replace with longest-increasing-subsequence to skip in-place items. |
| Suspense / async components | M1.7 | M2+ | No async story yet. |
| Module visibility design (`export`/`pub`/default) | M1.0 | M2 or M3 | User-flagged 2026-04-30. Today every top-level `let` auto-exports. Before users build real apps, decide public-vs-private default, opt-in keyword, re-exports, default export. AST already has an `exported` flag waiting for either direction. |
| Static-HTML optimization (skip h() for non-reactive subtrees) | M1.0 | post-M2 | User-flagged 2026-04-30. Detect markup subtrees that don't read any cell or parameter and emit them as `<template>`-cloned static HTML strings, like Svelte/Solid. Sizable perf + bundle win for typical UIs. |
| Style ↔ JS state interop (CSS variables auto-bound to cells) | M1.8 | post-M1.8 | User-flagged 2026-04-30. Want a syntax for declaring style values driven by Tu cells (probably CSS custom properties bound to Signal cells, surfaced as `var(--brand)` in CSS and `brand.set(...)` in JS). Pair with M1.8's scoping infrastructure. |

## Closed in M1.8

These rows tracked the pre-M1.8 scoping gap; M1.8 fills them and they are removed from Open. Kept here briefly so the closure shows in commit diffs:

- ~~Style scoping (auto class hash or `[data-tu-…]` attribute rewrite)~~ — landed via per-component FNV-1a hash + CSS rewrite
- ~~Symbolic class ref `.card` + pug-style `.card() {…}` shorthand~~ — landed
- ~~`let style = …` user variable name conflicts with `style { … }` block~~ — verified safe in current lexer (no `{` after `style`-as-RHS triggers CSS mode); covered by behaviour rather than syntax change
