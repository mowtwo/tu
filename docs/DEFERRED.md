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
| LSP V2: rename | M3 V1 | post-M3 | Completion landed in M3.4 and goto-definition in M3.5. Rename remains — it needs symbol-graph traversal across all open shadows + applyEdits round-trips through `mapTSRangeToSource` for every reference. |
| Static-HTML optimization (skip h() for non-reactive subtrees) | M1.0 | post-M2 | User-flagged 2026-04-30. Detect markup subtrees that don't read any cell or parameter and emit them as `<template>`-cloned static HTML strings, like Svelte/Solid. Sizable perf + bundle win for typical UIs. |
| Style ↔ JS state interop (CSS variables auto-bound to cells) | M1.8 | post-M1.8 | User-flagged 2026-04-30. Want a syntax for declaring style values driven by Tu cells (probably CSS custom properties bound to Signal cells, surfaced as `var(--brand)` in CSS and `brand.set(...)` in JS). Pair with M1.8's scoping infrastructure. |

## Closed in M3.7

- ~~LSP hover: cache LanguageService across hovers~~ — landed: new `packages/lsp/src/lsp-session.ts` owns a single-slot cache keyed by `(rootSource, rootFilename)` plus a snapshot of every transitively-imported `.tu` file's mtime. Hover / completion / definition all delegate through `getOrCreateSession` instead of building a fresh `ts.LanguageService` each call; the duplicate `createLsHost` was deleted from each surface. Cache invalidates when the root text changes, the filename changes, or any imported file's mtime advances. Disposal hook (`disposeSessionCache`) keeps tests isolated. The interactive loop (hover → click another ident → completion → goto-def) now reuses one TS Program.

## Closed in M3.6

- ~~`tu check` CLI command~~ — landed: `tu check <file…>` in `@tu/cli` calls `checkTuFile` from `@tu/lsp` and pretty-prints each diagnostic as `path:line:col: SEVERITY [TS####] message` followed by a 3-line code frame with `^^^` carets sized by the source-byte token range from M3.2. Empty input, non-`.tu` extension, missing files, and any error-severity diagnostic exit `1`; clean files print a one-line `tu check: N file(s) OK` summary and exit `0`. The CLI logic is exposed as `runCheck(args, options)` from `@tu/cli` so the test suite drives it without spawning a subprocess.

## Closed in M3.5

- ~~LSP V2: goto-definition~~ — landed: same `LanguageService` + reverse-mapping infrastructure as hover/completion. New `definitionAtTuPosition` calls `getDefinitionAtPosition`, then maps each TS `DefinitionInfo` back through the **target** shadow's `tokenMappings` (the definition might live in a different `.tu` file when crossing imports). Definitions whose `fileName` falls outside the shadow graph (e.g. `@tu/runtime`'s `.d.ts`) are dropped — we don't surface internal `.ts` files as a goto target. LSP server now advertises `definitionProvider: true`. Verified end-to-end: jumping from a `count` read to its `let count = 0` lands on cols 11..15 of line 0; jumping from a cross-file `Card("hi")` call lands on the `Card` ident in `Card.tu`.

## Closed in M3.4

- ~~LSP V2: completion~~ — landed: `completionsAtTuPosition` reuses the shadow graph + `LanguageService` and calls `getCompletionsAtPosition`. The reverse mapping was extended with an `inclusiveEnd` flag so cursors sitting at exactly `srcEnd` of an identifier (the typical case while typing) still resolve — the cap on the interior offset goes from `jsWidth - 1` (strict) to `jsWidth` (inclusive). LSP server advertises `completionProvider: { resolveProvider: false }` and maps TS `ScriptElementKind` → LSP `CompletionItemKind`. Verified that previously-declared idents, typed lambda params, and cross-`.tu` imported names all surface in the completion list.

## Closed in M3.3

- ~~LSP V2: hover (type / docs at cursor)~~ — landed: built on M3.2's `TokenMapping[]`. New `mapSourceLineColToTS` reverse-maps a `(line, col)` cursor in `.tu` to a TS byte offset using the same tightest-token algorithm as the diagnostic forward path. Shared shadow-graph helpers (`buildShadowGraph`, `tuPathToTs`, `getTuCompilerOptions`, `Shadow`) extracted to `packages/lsp/src/shadow-graph.ts` so both `checkTuSource` and the new `hoverAtTuPosition` use one BFS + one set of compiler options. Hover spins up a `ts.LanguageService` (one-shot per call) backed by the shadow graph and calls `getQuickInfoAtPosition`; results are formatted as Markdown-fenced TypeScript with optional JSDoc body. The originating source token's range — not `quickInfo.textSpan` — drives the hover range, so hovering on `count` underlines exactly `count`, not the surrounding statement. LSP server now advertises `hoverProvider: true` and routes `connection.onHover` through. Whitespace, Tu keywords (`let`, `if`), and punctuation (`=`, `=>`) gracefully return `null` because no `TokenMapping` covers them.

## Closed in M3.2

- ~~LSP V2: token-level diagnostic ranges~~ — landed: every AST node now carries `start` / `end` byte offsets (plus per-feature anchors like `nameStart` / `tagStart` / `calleeStart`). Codegen was refactored from string-returning emit to a streaming buffer that records a `TokenMapping { jsStart, jsEnd, srcStart, srcEnd }` for each emitted leaf token (idents, literals, callee names, param names, class refs). `compileToTSWithMap` returns the full `TokenMapping[]` alongside the V3 map; the LSP's `mapTSRangeToSource` finds the tightest TokenMapping containing the diagnostic's TS span and uses its source range. Squiggles now bracket the offending token (e.g. just `42` for an arg-type mismatch, or `"not a number"` for a state-cell assign) instead of the whole `let` header. Per-statement mapping remains as the fallback for diagnostics that land inside synthetic emit (`.get()`, runtime import). Same plumbing also enables the M3 hover work — every source token has a known TS counterpart now.

## Closed in M3.1

- ~~LSP V2: cross-`.tu` import resolution~~ — landed: `checkTuSource` now BFS-walks the import graph from the root file. Every reachable `.tu` is compiled to a TS shadow and registered in the CompilerHost's virtual fs, so tsserver resolves cross-`.tu` imports as if they were native `.ts` files. Compiler options gain `allowImportingTsExtensions: true` because Tu's codegen rewrites `./Foo.tu` → `./Foo.ts` in the shadow. Cycles tolerated via seen-set. In-memory edits to NON-root files are not yet seen — those still come from disk; lifting this restriction is small follow-up work for incremental multi-doc editing.

## Closed in M3 V1

- ~~LSP — diagnostics-only V1~~ — landed: `@tu/lsp` package boots a `vscode-languageserver` server; on document events it runs `compileToTS()` + the in-process TypeScript Compiler API and publishes diagnostics with positions mapped back to `.tu` line/col via the embedded V3 source map. `vscode-tu` activates the client on `onLanguage:tu`. End-to-end smoke-tested: a typed-param mismatch (`G(42)` against `(name: string) =>`) produces TS error 2345 mapped to the right `.tu` line. Hover / completion / goto-definition are all V2 work tracked in new rows above.

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
