# Example: Hello

The first end-to-end Tu demo. Compiles `Greeting.tu` (a static component) to ESM JavaScript, executes it, renders to an HTML string, and prints both the compiled JS and the resulting HTML.

## Run it

From this directory:

```bash
pnpm demo
pnpm demo Alice    # pass a custom name
```

Or from the repo root:

```bash
pnpm --filter @tu-examples/hello demo
```

## What it shows

| Feature | Where |
|---|---|
| Top-level `let` → `export const` | `let Greeting = ...` |
| Typed component props | `(props: GreetingProps) =>` |
| Trailing-closure DSL | `div(class: "greet") { ... }` |
| Mixed text + ident children | `h1 { "Hello, " name "!" }` |
| Nested tags as children | `div { h1 { ... } p { ... } }` |

## Out of scope (future milestones)

- Reactive state (`let count = 0` auto-binding to a Signal) — M1.1
- `computed`, `watch`, `effect` — M1.1
- `if` / `for` expressions — M1.2
- `style { ... }` block — M1.3
