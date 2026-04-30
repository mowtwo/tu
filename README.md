# Tu (图)

A reactive UI language. Trailing-closure DSL over HTML / CSS / state, scoped style blocks per component, top-level `let` auto-binds to TC39 Signals, types via TypeScript (Volar pattern), full LSP — hover, completion, goto-definition, rename, diagnostics.

> **Status**: pre-alpha (v0.0.0). The compiler, runtime, type system, full LSP, SSR (`renderToString` + client-side `hydrate`), and Custom Elements wrapper are all landed. Public preview is what this repo is.

**Docs**: [Language reference](docs/LANGUAGE.md) · [Deferred backlog](docs/DEFERRED.md) · [Examples](examples/) · [Playground](playground/)

---

## A quick taste

```tu
type Point = { x: number; y: number }

export let origin: Point = { x: 0, y: 0 }
export let snapshot = computed({ tag: "point", value: origin })

export let App = () => .panel() {
  h1 { "Hello, Tu!" }
  p { "origin.x = " origin.x ", origin.y = " origin.y }

  button(onClick: () => origin = { x: origin.x + 1, y: origin.y + 1 }) {
    "bump"
  }

  style {
    .panel { padding: 1rem; font-family: system-ui, sans-serif; }
    .panel > h1 { color: #312e81; }
  }
}
```

What's happening:
- `type Point = …` — a TS-style type alias; the RHS is captured verbatim and threaded into TS-mode emit so tsserver checks every use.
- `let origin: Point = { x: 0, y: 0 }` — top-level `let` auto-binds to a `Signal.State<Point>` cell. Object literal as value.
- `computed(…)` — a `Signal.Computed` cell. Reads of `origin` inside the body inject `.get()` automatically; the cell re-derives on mutation.
- `.panel() { … }` — pug-shorthand: a `<div class="panel panel-tu-XXX">` plus children. The `XXX` is a per-component hash; the `style { … }` block's selectors get the same suffix, so `.panel` styles never bleed across components.
- `origin.x` — postfix member access. `.` doesn't collide with prefix-dot ClassRef (`class: .card`) because they sit at different positions in the grammar.
- `origin = { x: origin.x + 1, y: origin.y + 1 }` — assignment desugars to `origin.set(…)` when the target is a state cell.

## Install + run a demo (60 seconds)

```bash
pnpm install
pnpm build

# Render a static greeting → HTML
pnpm --filter @tu-examples/hello demo

# Reactive counter (state cell + computed cell)
pnpm --filter @tu-examples/counter demo

# M5.6/7/8: object literals, return-type annotations, member access
pnpm --filter @tu-examples/typed demo

# Browser playground over every milestone demo
pnpm --filter tu-playground dev
```

The playground (`playground/`) runs Vite over the `examples/*/*.tu` source files via the [@tu-ui/vite](packages/vite-tu) plugin. Edit any `.tu` file under `examples/` while the dev server is up and the page reloads.

## Feature tour

| Capability | Example | Status |
|---|---|---|
| Trailing-closure DSL for markup | `div(class: "row") { h1 { "hi" } p { x } }` | ✅ |
| Top-level `let` → Signal cell | `let count = 0` (auto-wraps in `Signal.State`) | ✅ |
| Computed cells | `let doubled = computed(count * 2)` | ✅ |
| Style block + per-component scoping | `style { .card { … } }` + ClassRef `.card` | ✅ |
| Pug-style class shorthand | `.card() { … }` → `<div class="card …">` | ✅ |
| Multi-class shorthand | `.card.elevated() { … }` | ✅ |
| `:global(.foo)` escape hatch | `style { :global(.legacy) { … } }` | ✅ |
| Capitalized components are real functions | `Card("title") { children }` (no `h("Card", …)`) | ✅ |
| `Fragment { … }` for multi-root returns | `Fragment { header { … } main { … } }` | ✅ |
| Local `let` inside a block (plain const) | `() => { let g = "Hi, " + n; p { g } }` | ✅ |
| Type aliases | `type Point = { x: number; y: number }` | ✅ |
| Annotated bindings | `let count: number = 0` (wraps as `Signal.State<number>`) | ✅ |
| Lambda return-type annotation | `(n: number): Point => { x: n, y: n }` | ✅ |
| Object literals + member access | `let p = { x: 1 }; p.x` | ✅ |
| Array literals | `let xs = [1, 2, 3]` | ✅ |
| Cross-`.tu` imports + re-exports | `import { Card } from "./Card.tu"` | ✅ |
| `tu check` CLI | type-check `.tu` files with code-frame output | ✅ |
| LSP — diagnostics, hover, completion, goto-def, rename | `@tu-ui/lsp` + `vscode-tu` | ✅ |
| SSR | `renderToString(thunk())` | ✅ |
| Hydration | `hydrate(thunk, container)` (focus / scroll / `<input>` value preserved) | ✅ |
| Custom Elements wrapper | `defineCustomElement(thunk, "my-tag", { attributes })` | ✅ |
| Source maps | per-token V3 maps in JS + TS emit | ✅ |
| LIS-based keyed reorder | minimal moves on list reorders (Vue 3 / Inferno style) | ✅ |

For everything that's been **deferred** (per-component HMR, static-HTML optimization, local reactivity, etc.) see [docs/DEFERRED.md](docs/DEFERRED.md).

## Repository layout

```
packages/
├── compiler/    @tu-ui/compiler   lexer, parser, codegen, source maps
├── runtime/     @tu-ui/runtime    Signal + DOM glue (h, mount, hydrate, renderToString, Fragment)
├── vite-tu/     @tu-ui/vite       Vite plugin: load .tu files via the compiler
├── lsp/         @tu-ui/lsp        Language server (diagnostics + hover + completion + def + rename)
├── vscode/      vscode-tu      VS Code extension (syntax + icon + LSP client)
├── cli/         @tu-ui/cli        tu build / tu dev / tu check / tu fmt
├── format/      @tu-ui/format     formatter (Prettier plugin)
├── create-tu/   create-tu      project scaffold (npx create-tu-app)
└── std/         @tu-ui/std        standard library (placeholder)

examples/      hello, counter, todo, styled, scoped, clicker, diff, composition, typed, ssr
docs/          LANGUAGE.md, DEFERRED.md
playground/    Vite app — Tu-rendered chrome over every milestone demo
```

## Development

```bash
pnpm install
pnpm build       # turbo build all packages
pnpm test        # vitest across compiler, runtime, lsp, cli, vscode
pnpm check       # tsc --noEmit across packages
```

The compiler / runtime / LSP test suite covers ~280 cases across 7 files in `packages/compiler`, plus per-package suites for runtime, lsp, cli, and vscode-tu. The CLI's `tu check` integration test type-checks a real `.tu` file by spinning up the LSP shadow graph + a `ts.LanguageService`.

### VS Code syntax highlighting + LSP

```bash
pnpm --filter vscode-tu dev:install
# Then in VS Code: Cmd+Shift+P → "Developer: Reload Window"
```

After the reload, opening any `.tu` file gives you syntax highlighting, diagnostics squiggles on type errors, hover (TS-style quick-info incl. JSDoc), completion (idents, params, HTML tags, ClassRefs, CSS properties), goto-definition (same-file + cross-`.tu`), and rename (workspace edits).

To remove the dev install later: `pnpm --filter vscode-tu dev:uninstall`. Or press **F5** in this workspace to launch a separate Extension Development Host window with the extension preloaded.

## Status

Tu is **pre-alpha**. The language and runtime are usable end-to-end — every example in this repo runs, the LSP gives a real IDE experience, and the test suite passes — but APIs may change before v0.1. Issues / PRs welcome; expect rough edges.

See [CONTRIBUTING.md](CONTRIBUTING.md) for how the milestone numbering, deferred backlog, and PR shape work.

## License

[MIT](LICENSE)
