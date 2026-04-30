# Tu (图)

A reactive UI language with first-class signals, immutable-by-default state, and resumability-based SSR. Designed to compile cleanly to standard Web Components and play well with React / Vue / Svelte ecosystems.

> **Status**: pre-alpha (v0.0.0). Compiler, runtime, type-system, and full LSP (diagnostics + hover + completion + definition + rename) are landed; SSR, CE wrappers, and the v0.1 release are next.

**Docs**: [Language reference](docs/LANGUAGE.md) · [Deferred backlog](docs/DEFERRED.md)

## Concept

- JSX replacement: trailing-closure DSL unifying HTML, CSS, and SVG in one syntax
- Immutable-first: structural sharing, no `this`, no `class`, no `function` keyword
- Reactivity: top-level `let` auto-binds to TC39 Signals
- `?` operator: Rust-style early-exit propagation for nullable values
- SSR via resumability — no hydration mismatch, no double-execute
- Build targets: ESM, SSR, standard Custom Elements, `custom-elements.json` manifest, React / Vue / Svelte wrappers

## Repository Layout

```
packages/
├── compiler/    @tu/compiler   lexer, parser, type-mapper, codegen
├── runtime/     @tu/runtime    ~3 KB Signal + DOM glue (h, renderToString, mount)
├── vite-tu/     @tu/vite       Vite plugin: load .tu files via the compiler
├── lsp/         @tu/lsp        Volar-based language server
├── vscode/      vscode-tu      VS Code extension (syntax + icon)
├── cli/         @tu/cli        tu build / tu dev / tu check / tu fmt
├── format/      @tu/format     formatter (Prettier plugin; dprint later)
├── create-tu/   create-tu      project scaffold (npx create-tu-app)
└── std/         @tu/std        standard library (placeholder)

examples/
docs/
playground/
```

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm check
```

### Run the demos

```bash
# M1.0 — static Greeting compiled and rendered
pnpm --filter @tu-examples/hello demo
pnpm --filter @tu-examples/hello demo Alice

# M1.2 — reactive Counter: top-level let → Signal cell, computed cells auto-update
pnpm --filter @tu-examples/counter demo

# M1.3 — Todo: for / if / match expressions over a reactive list
pnpm --filter @tu-examples/todo demo

# M1.4 — Card: a component with a `style { ... }` block
pnpm --filter @tu-examples/styled demo

# M1.5 — Clicker: interactive counter, mounted into a jsdom-simulated browser
pnpm --filter @tu-examples/clicker demo

# M1.6 — playground: real-browser dev server, swaps between every milestone demo
pnpm --filter tu-playground dev
```

The playground runs Vite over `examples/*/*.tu` source files via the `@tu/vite` plugin. Edit any `.tu` file under `examples/` while the dev server is up and the page reloads.

### VS Code syntax highlighting (M1.1)

```bash
pnpm --filter vscode-tu dev:install
# Then in VS Code: Cmd+Shift+P → "Developer: Reload Window"
```

After the reload, opening any `.tu` file gives you syntax highlighting, bracket matching, comment toggling, and the language icon. To remove later: `pnpm --filter vscode-tu dev:uninstall`.

Alternatively press **F5** in this workspace to launch a separate "Extension Development Host" window with the extension preloaded — preferred for iterating on the grammar.

## Roadmap

| Milestone | Goal | Status |
|---|---|---|
| M0 | Monorepo scaffold | ✅ |
| M1.0 | Static `Greeting.tu` → ESM → HTML | ✅ |
| M1.1 | VS Code syntax highlighting + file icon | ✅ |
| M1.2 | Reactivity: `let count = 0` auto-binds to a Signal | ✅ |
| M1.3 | `if` / `for` expressions (originally `match` too; removed in M1.11) | ✅ |
| M1.4 | `style { … }` block | ✅ |
| M1.5 | Events + `mount()` (interactive components) | ✅ |
| M1.6 | Vite plugin + browser playground | ✅ |
| M1.7 | Keyed diff (focus-preserving + reorder) | ✅ |
| M1.8 | Style scoping + `.card` symbolic refs + pug shorthand | ✅ |
| M1.9 | Error UX: file:line:col + code frame, V3 source maps | ✅ |
| M1.10 | Module visibility: private-by-default + `export let` | ✅ |
| M1.11 | Drop `match` (TC39 Pattern Matching collision) | ✅ |
| M2 | Type system via TypeScript + `.d.ts` emit (V1: erasure-only) | ✅ |
| M2.1 | Cross-`.tu` `import { X } from "./other.tu"` + re-exports | ✅ |
| M3 V1 | LSP — diagnostics via TypeScript Compiler API | ✅ |
| M3.1 | LSP — cross-`.tu` import resolution | ✅ |
| M3.2 | Token-level diagnostic ranges + per-token V3 source maps | ✅ |
| M3.3 | LSP hover (type + JSDoc at cursor) | ✅ |
| M3.4 | LSP completion (idents, params, cross-`.tu` imports) | ✅ |
| M3.5 | LSP goto-definition (same-file + cross-`.tu`) | ✅ |
| M3.6 | `tu check` CLI — type-check `.tu` files with code-frame output | ✅ |
| M3.7 | LanguageService cache (single-slot, mtime-aware) | ✅ |
| M3.8 | LSP rename (cross-`.tu` workspace edits) | ✅ |
| M3.9 | Synthesized `${Name}Props` interfaces in TS emit | ✅ |
| M2.2 | Annotated `let X: T = …` declarations | ✅ |
| M2.3 | Cross-`.tu` import classification (reactivity fix) | ✅ |
| M2.4 | Type aliases (`type X = …`) + lex `\| & ; [ ]` | ✅ |
| M2.5 | Array literals `[a, b, c]` + Todo.tu owns its controls | ✅ |
| M1.12 | Pug-shorthand multi-class + `tag:` override | ✅ |
| M1.13 | `:global(.foo)` CSS escape hatch | ✅ |
| M1.14 | Counter.tu owns its own `+`/`−`/`reset` buttons | ✅ |
| M1.15 | LIS-based keyed reorder (Vue/Inferno-style) | ✅ |
| M4 V1 | Client-side `hydrate(thunk, container)` for SSR | ✅ |
| M4.1 | `defineCustomElement(thunk, tagName)` runtime helper | ✅ |
| M4 | Framework wrapper targets (React / Vue / Svelte / Solid) | … |
| M5 | Dev server polish + project template | … |
| M6 | Docs + playground + v0.1 alpha release | … |

## License

MIT
