# Example: Styled (M1.4 + M1.8 — scoped `style { … }` blocks)

A component that pairs its markup with a `style { … }` block, scoped via M1.8 symbolic class refs.

- `class: .card` (and the pug-shorthand `.card() { … }`) bind to the symbolic class declared in the surrounding component's style block.
- The compiler hashes every declared class name with a per-component suffix (`card` → `card-tu-873143`) and rewrites both the markup attributes and the CSS selectors atomically, so two components declaring the same `.card` don't collide.

## Run it

```bash
pnpm --filter @tu-examples/styled demo
```

The runner writes `dist/Card.html`. Open it in a browser to verify the CSS lands correctly.

## What it shows

| Tu form | Compiled to |
|---|---|
| `.card() { … }` | `h("div", { class: "card-tu-{hash}" }, [ … ])` |
| `class: .card__title` | `class: "card__title-tu-{hash}"` (same hash as the style block declares) |
| `style { .card { … } }` | `<style>.card-tu-{hash} { … }</style>` |
| Two components both declaring `.card` | each gets a different `{hash}`, so styles don't bleed |

## Caveats

- Selectors not declared inside the component's style block are treated as global (e.g. `.card .legacy-thing` rewrites only `.card`).
- No `:global(...)` escape hatch yet — every `.identifier` selector inside a scoped component's style block becomes scoped.
- M1.8 V1 only supports default `div` for the pug shorthand (no `.foo(tag: "section")`) and a single class per shorthand.
