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
├── runtime/     @tu/runtime    ~3 KB Signal + DOM glue
├── lsp/         @tu/lsp        Volar-based language server
├── vscode/      @tu/vscode     VS Code extension
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

## Roadmap

| Milestone | Goal | Status |
|---|---|---|
| M0 | Monorepo scaffold | ✅ |
| M1 | Compile `Counter.tu` → ESM, run on Node | … |
| M2 | Type inference + `.d.ts` emit | … |
| M3 | LSP + VS Code extension + formatter | … |
| M4 | SSR / CE / wrapper targets | … |
| M5 | CLI + dev server + project template | … |
| M6 | Docs + playground + v0.1 alpha release | … |

## License

MIT
