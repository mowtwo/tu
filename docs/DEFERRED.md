# Deferred work — Tu

A living list of every "leave for later" decision made during a milestone, with the milestone that introduced the gap and (when known) where it should land. Rows are removed in the commit that fills them, so the diff shows the loop closing.

## Open

| Item | Introduced | Target | Notes |
|---|---|---|---|
| CSS4 nesting / `@layer` / `@scope` awareness in style block | M1.4 | M1.9+ | M1.8 ships a regex-style class scanner that handles flat selectors and most nested rules correctly (the regex matches `.foo` anywhere, including inside nested blocks). Edge cases like `:is()`, `@scope`, and selector lists need a real CSS parser. |
| Per-component fine-grained HMR boundaries | M1.6 | post-M1.7 | The `@tu/vite` plugin currently triggers a full module re-import + re-mount on `.tu` save. Per-component preserve-state HMR is future work. |
| Local reactivity (per-cell-read subscriptions) | M1.7 | M2+ | Keyed diff is cheap, but the component thunk still re-runs in full on every cell mutation. Solid-style per-binding patches that only touch the affected text node / attribute are a deeper rework — needs a different compiler IR that wraps each cell read in its own reactive scope. |
| Suspense / async components | M1.7 | M2+ | No async story yet. |
| Default export (`export default …`) | M1.10 | TBD | Tu's no-`function`-keyword aesthetic argues against it; revisit when component-as-file becomes idiomatic. |
| Synthesize style-class literal-type union in TS emit | M2 | M3 / LSP polish | Today the codegen rejects undeclared `.classRef` at compile time (M1.8). For IDE completion of `.foo` against the declared set, emit a `type ClassesOf_X = "card" \| "card__title"` and type the `class:` prop accordingly. |
| Static-HTML optimization (skip h() for non-reactive subtrees) | M1.0 | post-M2 | User-flagged 2026-04-30. Detect markup subtrees that don't read any cell or parameter and emit them as `<template>`-cloned static HTML strings, like Svelte/Solid. Sizable perf + bundle win for typical UIs. |
| Style ↔ JS state interop (CSS variables auto-bound to cells) | M1.8 | post-M1.8 | User-flagged 2026-04-30. Want a syntax for declaring style values driven by Tu cells (probably CSS custom properties bound to Signal cells, surfaced as `var(--brand)` in CSS and `brand.set(...)` in JS). Pair with M1.8's scoping infrastructure. |

## Closed in M3.13

- ~~CSS diagnostics inside `style { … }`~~ — landed: `validateCssBlocks` (in the new `css-lsp.ts` module) walks every style block in the program and runs `cssLs.doValidation`. Diagnostic ranges come back in CSS-doc-relative coordinates and are translated to source-doc absolute (line, col, length) via the same offset-math the M3.12 hover path uses. `checkTuSource` augments its TS-only diagnostic list with these. Misspellings (`colour: red`) and other CSS-LS-known issues now squiggle on the offending property/value, not the surrounding let-decl. CSS diagnostics use a `code: -1` sentinel since CSS LS doesn't carry TS-style numeric codes — `tu check` and the LSP server suppress the `[code]` tag for those.

## Closed in M3.12

- ~~CSS hover inside `style { … }`~~ — landed: `hoverAtTuPosition` checks `findCssContextAt` first; if the cursor is in a CSS body, it delegates to `cssLs.doHover()` and translates the returned range from CSS-doc coordinates to source-doc coordinates so the LSP underline lands on the property/value the cursor pointed at. CSS hover content (a Markdown-formatted property doc with a link to MDN) flows back as the `TuHover.contents`. Falls through to tsserver only when the cursor is outside any style block.

## Closed in M3.11

- ~~CSS completion inside `style { … }` blocks~~ — landed: `@tu/lsp` now depends on `vscode-css-languageservice`. The parser was extended to record `cssStart` / `cssEnd` byte offsets on the `StyleBlock` AST node so completion can find the inner CSS span; `completionsAtTuPosition` checks first whether the cursor is inside any StyleBlock's CSS region and, if so, slices that text into a synthetic CSS `TextDocument`, calls `ls.doComplete()` at the cursor's CSS-relative position, and maps the items to `TuCompletionItem`. tsserver/HTML-tag/ClassRef paths skip entirely while inside a style block — CSS context is exclusive. CSS hover and diagnostics are split out as a fresh open row.

## Closed in M3.10

- ~~Tu-aware completion (HTML tags + ClassRefs)~~ — landed: `completionsAtTuPosition` now augments tsserver's results with two Tu-specific sources. (1) HTML tag names appear when the cursor is at expression-head — detected by tokenizing up to the cursor and checking that the previous token is one of `{`, `(`, `,`, `=`, `:`, `=>`, or `else`. (2) Declared class names appear when the cursor sits right after a `.` inside a scoped component — found by parsing the source (with a placeholder-retry for incomplete forms like `class: .`) and looking up the host LetDecl's style-block classes via the new `getScopedClassMap` export from `@tu/compiler`. Existing tsserver-based completions stay; this only adds items, deduped by label. CSS-content completion inside `style { … }` is split out as a fresh open row for later.

## Closed in M2.5 (empty-array widening)

- ~~`let xs = []` inferred as `Signal.State<never[]>`~~ — landed: codegen detects empty `ArrayLit` initializers (without an explicit type annotation) and emits `new Signal.State<any[]>(…)` / `new Signal.Computed<any[]>(…)` so subsequent `.set(["a", "b"])` and `for item in xs` calls don't trip on `never` inference. Explicit annotations (`let xs: number[] = []`) take precedence — the annotation fully determines the type.

## Closed in M4 V1

- ~~Client-side `hydrate(thunk, container)`~~ — landed: `@tu/runtime` ships `hydrate` alongside `mount`. The first render adopts existing DOM children rather than creating new ones — same `<button>` / `<input>` instance pre- and post-hydrate, so focus / scroll / `<input>.value` survives the server-to-client handoff. Event listeners (which SSR can't serialize) and DOM-property props (`value`, `checked`, `selected`) are applied during the walk. The runtime splits any Text node that SSR fused from adjacent text vnodes (e.g. `"count = " count` → one Text "count = 0" → two Text nodes) so future cell mutations only touch the dynamic tail. Whitespace-only text nodes between elements (incidental from pretty-printed HTML) are skipped. Structural mismatches log `[@tu/runtime] hydration mismatch: …` warnings and fall back to materializing the offending vnode. A new `examples/ssr/` runs the full round-trip (renderToString → jsdom-with-pre-stamped-HTML → hydrate → simulated clicks) end-to-end. Pre-resumability — Qwik-style "no first-frame thunk re-execution" is deferred to a later M4 milestone.

## Closed in M2.5

- ~~Array literals `[a, b, c]`~~ — landed: parser recognizes `[` in expression position as an `ArrayLit` (the `[` / `]` tokens that M2.4 added for type spans now do double duty for value syntax). AST walkers (class-ref + style-block scanners) descend into elements. Codegen emits the JS-equivalent literal verbatim. Todo.tu now owns its empty/one/three-items controls via three private lambdas that build fresh items arrays inline — playground's external controls block deleted, narrowing M1.14's scope and closing the "Todo.tu needs its own controls" row.

## Closed in M3.9

- ~~Synthesize component-prop interfaces in TS emit~~ — landed: codegen now emits `export interface ${Name}Props { p1: T1; p2: T2 }` immediately before each exported lambda whose params are all typed. Lambdas with zero params, any untyped param, or non-exported scope are skipped — no fictional `unknown` fields. JS-mode emission stays unchanged. Verified end-to-end via the Greeting.tu example: `export interface GreetingProps { name: string }` now precedes the const, giving downstream `.d.ts` consumers a named, reusable shape.

## Closed in M2.4

- ~~Type vs value namespace + type aliases (`type X = …`)~~ — landed: `type X = …` and `export type X = …` now parse as top-level declarations. `type` is a contextual keyword (only triggers when followed by `Ident =` at statement boundary), so users keep the freedom to name a value `type` (lambda param, let-decl name, etc.) without conflict. The RHS is captured as a raw source slice and emitted verbatim into the TS shadow; JS mode erases the alias entirely. Lexer gained `[`, `]`, `|`, `&`, `;` tokens — currently consumed only inside raw-type spans, but available to future expression syntax. Verified `let count: Counter = 0` (using a previously-declared alias) and round-trips through tsserver. Type-namespace question dissolves automatically: TS already keeps `type` and `const` separate.

## Closed in M2.3

- ~~Imported names are always classified as functions in codegen~~ — landed: `compileWithMap` / `compileToTSWithMap` accept an optional `importedNameKinds: Map<string, CellKind>` so the caller can tell codegen which imported names are state / computed / function cells. Imports without an explicit kind still default to `'function'`, preserving the standalone-compile path. The LSP's shadow graph and the `@tu/vite` plugin both build this map by AST-classifying each `.tu` neighbor's `export let` bindings; the M2.1 reactivity bug (importing a `Signal.State` silently dropped `.get()` injection) is fixed for both flows. Multi-hop re-export chains still fall through to `'function'` — small follow-up.

## Closed in M1.14

- ~~Counter.tu owns its buttons~~ — landed: Counter.tu now declares private `inc / dec / reset` lambdas and wires them via `onClick:` props on three buttons inside the component body. The playground's external `controls: () => [...]` block was deleted. The SSR run.mjs continues to demonstrate external mutation (`mod.count.set(5)` from JS), so both interactive and out-of-band paths are exercised. Todo.tu is left externally-driven for now — without Tu array literals, the .tu source can't build a fresh `items` list in-place; tracked in a narrowed open row.

## Closed in M1.15

- ~~LIS-based move minimization in keyed reorder~~ — landed: `patchChildren` replaces the forward `insertBefore` pass with a patience-sort longest-increasing-subsequence over `newToOld[]`. Items whose old indices form an increasing subsequence (the stable middle) skip movement; the position pass walks right-to-left and `insertBefore`s only the others. Verified with a regression test: swapping list endpoints `[A B C D E] → [E B C D A]` was 4 moves before, exactly 2 (A and E) now. Same algorithm as Vue 3 / Inferno, O(n log n).

## Closed in M1.13

- ~~`:global(.foo)` escape hatch for unscoped selectors~~ — landed: scanner skips class tokens inside `:global(...)` regions (depth-tracked across nested parens) so they're never registered as "declared" classes for the component's hash. The rewriter strips the wrapper itself, emitting `.legacy` (unhashed) where the source had `:global(.legacy)`. Compound selectors mix freely: `.card :global(.icon)` becomes `.card-tu-h .icon`.

## Closed in M2.2

- ~~Annotated `let X: type = …` declarations~~ — landed: parser captures the raw source slice between `:` and `=` (depth-tracked across `()` / `{}` / `<…>` so generic args don't terminate the type early). The slice is plumbed through `LetDecl.type` and emitted by codegen in TS mode only — JS mode continues to erase types. Wrapping rules match the value: lambdas pass the annotation through to the const directly, state cells emit `Signal.State<T>`, computed cells emit `Signal.Computed<T>`. Lets users override TS inference for opaque cells (`let total: BigDecimal = computed(...)`) and document component shapes (`let App: () => VNode = …`).

## Closed in M1.12

- ~~Multi-class pug shorthand `.foo.bar()`~~ — landed: parser greedily consumes a `.foo.bar.baz` chain. Single-ref → `ClassRef` (unchanged). Multi-ref → a `+`-chain interleaved with `" "` StringLits, so codegen emits `(("foo-tu-h" + " ") + "bar-tu-h")` and the runtime sees a space-joined class string. Same chain works in non-shorthand position too: `class: .foo.bar` is now valid.
- ~~Pug-shorthand tag override `.foo(tag: "section")`~~ — landed: the `tag:` prop is special-cased inside `parsePugShorthandTail` — extracted from the args, validated as a `StringLit`, and used as the synthetic TagCall's tag. Default stays `div` when omitted. The `tag:` prop is consumed (never emitted as an HTML attribute) and a non-literal value (e.g. `tag: someExpr`) throws a parse error since the tag is a compile-time decision.

## Closed in M3.8

- ~~LSP V2: rename~~ — landed: `renameAtTuPosition` calls `LanguageService.findRenameLocations` and groups the results by `fileName`, mapping each TS textSpan back through the **target** shadow's `tokenMappings` so cross-`.tu` references receive the same edit as the local declaration. The new identifier is validated against Tu's identifier rules (`/^[A-Za-z_$][A-Za-z0-9_$]*$/`) before any TS work, so a malformed rename never produces broken sources. LSP server advertises `renameProvider: true` and assembles `WorkspaceEdit { changes }` from the per-file edit groups. Verified end-to-end: renaming `count` rewrites both decl and read; renaming `Card` from a call-site rewrites the import + call in `App.tu` AND the declaration in `Card.tu`.

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
- ~~Token-level (vs per-statement) source maps~~ — landed as a side-effect of token-level diagnostics: `buildV3Map` now folds the same `TokenMapping[]` into the V3 `mappings` field as additional segments, so browser stack traces (and any tool that consumes the standard source map) resolve to the precise source token's start. Per-statement segments remain as anchors for emit regions that have no token (synthetic `.get()`, runtime import, control-flow scaffolding).

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
