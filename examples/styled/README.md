# Example: Styled (M1.4 — `style { … }` blocks)

A component that pairs its markup with a `style { … }` block. The compiler emits the markup and the styles as a fragment, so a single `Card(...)` call returns both the `<div>` and a sibling `<style>` element.

## Run it

From this directory:

```bash
pnpm demo
```

Or from the repo root:

```bash
pnpm --filter @tu-examples/styled demo
```

The runner writes `dist/Card.html`. Open it in a browser to verify the CSS landed correctly.

## What it shows

| Tu form | Compiled to |
|---|---|
| `style { .card { … } }` | `h("style", {}, [".card { … } "])` (raw CSS preserved) |
| Lambda body with `div { … }` + `style { … }` | array fragment `[divVNode, styleVNode]` |
| `<style>` rendered to HTML | text content NOT HTML-escaped (raw-text element per spec) |

## Caveats

- M1.4 has **no scoping rewrite**. Selectors are global; an outer `.card` would collide.
- A future milestone will hash class names or rewrite selectors with `[data-tu-…]` attributes.
