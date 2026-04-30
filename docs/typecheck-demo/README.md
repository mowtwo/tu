# M3 V1 typecheck demo

A `.tu` file with three intentional type errors, plus one well-typed binding for contrast. Open it in VS Code (after `pnpm --filter vscode-tu dev:install` and a window reload) to see the `@tu-lang/lsp` diagnostics in action.

## How to view it

```bash
pnpm --filter vscode-tu dev:install
# Cmd+Shift+P → "Developer: Reload Window"
# Then open docs/typecheck-demo/Errors.tu
```

## What you should see

`Errors.tu` contains four bindings:

| Line | Binding | Expected diagnostic |
|---|---|---|
| 15 | `bad1 = () => count = "abc"` | `Argument of type 'string' is not assignable to parameter of type 'number'.` (TS 2345) |
| 22 | `bad2 = () => G(42)` | `Argument of type 'number' is not assignable to parameter of type 'string'.` (TS 2345) |
| 28 | `bad3 = () => triple("nope")` | `Argument of type 'string' is not assignable to parameter of type 'number'.` (TS 2345) |
| 33 | `good = () => G("World")` | clean — no squiggle |

Each squiggle sits at column 0 of the offending `let` line because M3 V1's source maps are per-top-level-statement. Token-level ranges land in V2.

## What V1 does NOT do yet

- No hover info on well-typed identifiers (you can't hover `count` to see `Signal.State<number>`)
- No autocomplete
- No goto-definition
- No cross-`.tu` import resolution (importing from another `.tu` triggers a "cannot find module" error inside the LSP)

These are V2 work. V1 is "open a file, see your type errors as red squiggles."

## Verifying without VS Code

You can run the same diagnostics from Node:

```js
import { checkTuFile } from '@tu-lang/lsp'

console.log(checkTuFile('docs/typecheck-demo/Errors.tu'))
// → 3 entries with severity: 'error' on lines 15, 22, 28
```
