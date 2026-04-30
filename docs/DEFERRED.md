# Deferred work — Tu

A living list of every "leave for later" decision made during a milestone, with the milestone that introduced the gap and (when known) where it should land. Rows are removed in the commit that fills them, so the diff shows the loop closing.

## Open

| Item | Introduced | Target | Notes |
|---|---|---|---|
| Style scoping (auto class hash or `[data-tu-…]` attribute rewrite) | M1.4 | M1.8 | Selectors are global today; multi-component pages will collide. |
| Symbolic class ref `.card` + pug-style `.card() {…}` shorthand | M1.4 | M1.8 | User-flagged 2026-04-30. Must land before scoping; scoping should rewrite via the symbol graph, not strings. |
| CSS4 nesting / `@layer` / `@scope` awareness in style block | M1.4 | M1.8+ | Currently style body is opaque text; the scoping pass needs to understand it. |
| Per-component fine-grained HMR boundaries | M1.6 | post-M1.7 | The `@tu/vite` plugin currently triggers a full module re-import + re-mount on `.tu` save. Per-component preserve-state HMR is future work. |
| Source maps from compiled JS back to `.tu` source | M1.0 | M2/M3 | Vite's default sourcemap covers JS-as-served, but error stacks point at the generated JS, not the original `.tu` lines. |
| Better error messages with source location + caret | M1.0 | M2/M3 | Lexer/parser throw `SyntaxError` with offset numbers; users want line:col + a code frame. |
| Counter.tu and Todo.tu need their own buttons (currently the playground chrome supplies them) | M1.6 | when adding event-handler-rich examples | The .tu source in those examples has no `onClick` — playground main.js wires controls externally. Better demo when the `.tu` itself owns the buttons. |
| `let style = …` user variable name conflicts with `style { … }` block | M1.4 | M1.8 (rework) | Currently the lexer treats any `style` Ident followed by `{` as a CSS block trigger. Fine in practice (no one has tried it yet), but the symbolic-binding rework should disambiguate properly. |
| Local reactivity (per-cell-read subscriptions) | M1.7 | M2+ | Keyed diff is cheap, but the component thunk still re-runs in full on every cell mutation. Solid-style per-binding patches that only touch the affected text node / attribute are a deeper rework — needs a different compiler IR that wraps each cell read in its own reactive scope. |
| LIS-based move minimization in keyed reorder | M1.7 | post-M1.7 | Current `patchChildren` uses a simple "walk forward, insertBefore as needed" pass — correct, but moves more nodes than strictly necessary on long-range reorders. Replace with longest-increasing-subsequence to skip in-place items. |
| Suspense / async components | M1.7 | M2+ | No async story yet. |

## Closed (kept here briefly so the closure shows in commit diffs)

_Empty — populate when items land._
