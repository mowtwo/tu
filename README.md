# Tu (图)

A reactive UI language with first-class signals, immutable-by-default state, and resumability-based SSR. Designed to compile cleanly to standard Web Components and play well with React / Vue / Svelte ecosystems.

> **Status**: pre-alpha (v0.0.0). Not usable yet — language design and compiler are under active development.

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
| M2 | Type system via TypeScript (Volar pattern) + `.d.ts` emit | … |
| M3 | Full LSP via Volar + formatter | … |
| M4 | SSR / CE / wrapper targets | … |
| M5 | CLI + dev server + project template | … |
| M6 | Docs + playground + v0.1 alpha release | … |

## License

MIT
