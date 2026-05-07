// Tu-native docs page (install.tu).

export let frontmatter = {}

export let Page = () => div {
  markdown {
    # Install

    Tu is published to npm under the `@tu-lang/*` scope (and `create-tu` for the project starter). It is currently **pre-alpha** — the `latest` tag is not used; releases land on the `alpha` tag.

    ## Use Tu in a project

    ### Compiler + runtime + Vite plugin

    ```sh
    pnpm add -D @tu-lang/vite@alpha @tu-lang/compiler@alpha
    pnpm add @tu-lang/runtime@alpha @tu-lang/dom@alpha @tu-lang/router@alpha
    ```

    `@tu-lang/runtime` is universal — Signals, vnode construction, SSR helpers (`renderToString`, `renderPageAsync`, `renderToStream`, `Suspense`). `@tu-lang/dom` is the browser side — `mount`, `hydrate`, `defineCustomElement`, plus typed re-exports of common DOM types. `@tu-lang/router` adds DOM-free route matching and SSR render helpers. Server-only consumers (Node SSR, edge functions) usually need `@tu-lang/runtime` and optionally `@tu-lang/router`. See [LANGUAGE: Runtime + platform packages](./LANGUAGE#runtime--platform-packages).

    ```ts
    // vite.config.ts
    import { defineConfig } from 'vite'
    import tu from '@tu-lang/vite'

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
    pnpm add -D @tu-lang/cli@alpha
    pnpx tu check src/**/*.tu
    ```

    ## VS Code: syntax + LSP

    The VS Code extension (`vscode-tu`) is **not yet on the Marketplace**. Two ways to use it today:

    ### Option A — install from a `.vsix` (when published)

    The Marketplace listing and a `.vsix` artifact under `Releases` are planned but not yet published. Until then, use Option B.

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
    | [`@tu-lang/runtime`](https://www.npmjs.com/package/@tu-lang/runtime) | Universal Signals, vnode construction, SSR, Suspense, and streaming helpers | alpha |
    | [`@tu-lang/dom`](https://www.npmjs.com/package/@tu-lang/dom) | Browser-only `mount`, `hydrate`, `defineCustomElement`, diffing, and DOM type re-exports | alpha |
    | [`@tu-lang/router`](https://www.npmjs.com/package/@tu-lang/router) | Universal route matching plus SSR helpers (`createRouter`, `renderRoute`, `renderRouteToStream`) | alpha |
    | [`@tu-lang/compiler`](https://www.npmjs.com/package/@tu-lang/compiler) | Lexer / parser / codegen / source maps | alpha |
    | [`@tu-lang/vite`](https://www.npmjs.com/package/@tu-lang/vite) | Vite plugin — load `.tu` modules on import | alpha |
    | [`@tu-lang/lsp`](https://www.npmjs.com/package/@tu-lang/lsp) | Language server (diagnostics + hover + completion + def + rename) | alpha |
    | [`@tu-lang/cli`](https://www.npmjs.com/package/@tu-lang/cli) | `tu build` / `tu dev` / `tu check` / `tu fmt` | alpha |
    | [`@tu-lang/format`](https://www.npmjs.com/package/@tu-lang/format) | Prettier plugin (dprint port later) | alpha |
    | [`@tu-lang/std`](https://www.npmjs.com/package/@tu-lang/std) | Standard library — placeholder | alpha |
    | [`create-tu`](https://www.npmjs.com/package/create-tu) | `npm create tu` scaffold | alpha |

    Source for everything: [github.com/mowtwo/tu](https://github.com/mowtwo/tu).

  }
}
