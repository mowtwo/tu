# Install

Tu is published to npm under the `@tu/*` scope (and `create-tu` for the project starter). It is currently **pre-alpha** — the `latest` tag is not used; releases land on the `alpha` tag.

## Use Tu in a project

### Compiler + runtime + Vite plugin

```sh
pnpm add -D @tu/vite@alpha @tu/compiler@alpha
pnpm add @tu/runtime@alpha
```

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import tu from '@tu/vite'

export default defineConfig({
  plugins: [tu()],
})
```

Now any `*.tu` file in your project gets compiled on import.

### Scaffold a fresh project

```sh
pnpm create tu my-app
cd my-app
pnpm dev
```

(`create-tu` is the npm starter template; the v0.1 version is minimal — expect rough edges.)

### Type-check `.tu` files in CI

```sh
pnpm add -D @tu/cli@alpha
pnpx tu check src/**/*.tu
```

## VS Code: syntax + LSP

The VS Code extension (`vscode-tu`) is **not yet on the Marketplace**. Two ways to use it today:

### Option A — install from a `.vsix`

Download the latest `.vsix` from this site and install it manually:

- [vscode-tu-latest.vsix](./install/vscode-tu-latest.vsix) *(coming soon — built by the docs deploy workflow)*

```sh
code --install-extension vscode-tu-latest.vsix
```

### Option B — clone + dev-install

```sh
git clone https://github.com/mowtwo/tu
cd tu
pnpm install
pnpm --filter vscode-tu dev:install
```

Then in VS Code: `Cmd+Shift+P` → "Developer: Reload Window". Tu syntax highlighting, diagnostics squiggles, hover, completion, goto-definition, and rename all light up.

## TextMate grammar (for other editors / tooling)

The same grammar that drives the VS Code extension and the syntax highlighting on this site:

- [tu.tmLanguage.json](./grammar/tu.tmLanguage.json)

Drop it into any TextMate-compatible editor (Sublime, Atom, Nova, …) or feed it to Shiki / highlight.js / a custom highlighter.

## AI agent skill

If you're an LLM (or driving one), the [skill page](./skill) is written for direct ingestion — copy the markdown into a system prompt, save it as `.claude/skills/tu/SKILL.md`, or fetch the plain-text mirror at [`/llms.txt`](./llms.txt).

## What's published

| Package | Role | Stage |
|---|---|---|
| [`@tu/runtime`](https://www.npmjs.com/package/@tu/runtime) | Signal cells + DOM glue (`h`, `mount`, `hydrate`, `renderToString`, `Fragment`, `defineCustomElement`) | alpha |
| [`@tu/compiler`](https://www.npmjs.com/package/@tu/compiler) | Lexer / parser / codegen / source maps | alpha |
| [`@tu/vite`](https://www.npmjs.com/package/@tu/vite) | Vite plugin — load `.tu` modules on import | alpha |
| [`@tu/lsp`](https://www.npmjs.com/package/@tu/lsp) | Language server (diagnostics + hover + completion + def + rename) | alpha |
| [`@tu/cli`](https://www.npmjs.com/package/@tu/cli) | `tu build` / `tu dev` / `tu check` / `tu fmt` | alpha |
| [`@tu/format`](https://www.npmjs.com/package/@tu/format) | Prettier plugin (dprint port later) | alpha |
| [`@tu/std`](https://www.npmjs.com/package/@tu/std) | Standard library — placeholder | alpha |
| [`create-tu`](https://www.npmjs.com/package/create-tu) | `npm create tu` scaffold | alpha |

Source for everything: [github.com/mowtwo/tu](https://github.com/mowtwo/tu).
