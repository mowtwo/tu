# @tu-ui/lsp

Language Server Protocol implementation for Tu — diagnostics-only V1 powered by the TypeScript Compiler API.

## What works (M3 V1)

- **Diagnostics.** Every `.tu` open / change / save runs through:
  1. `compileToTS()` from `@tu-ui/compiler` (preserves lambda param types so tsserver can infer everything else)
  2. The TypeScript Compiler API in-process (no `tsc` spawn — sub-second on small modules)
  3. Each `ts.Diagnostic` is mapped back to `.tu` line / col via the V3 source map embedded in the compiled TS
- **Tu compile errors** (lex/parse/codegen) surface as a single diagnostic at the top of the file with the same line:col + code-frame text M1.9 produces from the CLI.
- **VS Code integration.** The `vscode-tu` extension activates this server on `onLanguage:tu` via `vscode-languageclient`.

## What does NOT work yet (V2 work)

- Hover info, autocomplete, go-to-definition, rename. Requires the Volar framework or a richer integration with tsserver.
- Cross-`.tu` import resolution at the LSP layer — the diagnostic pass is single-file, so `import { X } from "./other.tu"` triggers a "cannot find module" error inside the LSP. Fix in V2 by virtualizing the entire workspace's `.tu` files as TS shadows in the program.
- Token-level diagnostic ranges. Right now the M2 V1 source map is per-top-level-statement, so a diagnostic shows up at the start of the offending `let` / `import` line, not pointed at the exact token. Fixing this requires a finer source-map emit pass in `@tu-ui/compiler`.
- Synthesized component-prop interfaces, style-class literal-type unions — sugar typing that goes beyond what tsserver infers from the compiled JS shape.

## Public API

```ts
import { checkTuSource, checkTuFile, type TuDiagnostic } from '@tu-ui/lsp'

const diags = checkTuSource('export let x = 0', 'a.tu')
// → []

const diags = checkTuSource(
  'export let G = (name: string) => p { name }\n' +
  'export let App = () => G(42)',
  'b.tu'
)
// → [{ line: 1, col: 0, severity: 'error', message: "Argument of type 'number' is not assignable to parameter of type 'string'.", code: 2345, length: 2 }]
```

The exported `server.js` (binary `tu-lsp`) is the LSP entrypoint launched by `vscode-tu`. It speaks LSP over IPC.
