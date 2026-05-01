# tu-xing (图形)

Tu-native UI component library. shadcn + baseui style: Tailwind-driven primitives with theme tokens.

## Status: pre-alpha

V1 ships seven primitives: **Button · Input · Card · Badge · Switch · Dialog · Tabs**.

Style philosophy:

- **shadcn-like**: every component is a single `.tu` file. Source-only — consumers import via `@tu-lang/vite` (no compiled artifact). Easy to fork into your own project.
- **baseui-like**: theme tokens live in `theme.css` as HSL CSS variables (`--tu-brand`, `--tu-surface`, …). Override at the document root to retheme.
- **Tailwind-driven**: every component uses Tailwind utility classes referencing the theme tokens via `bg-[hsl(var(--tu-brand))]` and friends. You need Tailwind v4 + the `@source` directive pointing at your `.tu` files (see `examples/tailwind/` in the repo).

## Install

```sh
pnpm add @tu-lang/tu-xing @tu-lang/runtime
pnpm add -D tailwindcss @tailwindcss/vite @tu-lang/vite
```

In your entry CSS:

```css
@import "tailwindcss";
@import "@tu-lang/tu-xing/theme.css";
@source "./**/*.tu";
@source "../node_modules/@tu-lang/tu-xing/src/**/*.tu";
```

## Use

```tu
import { Button, Card, Badge } from "@tu-lang/tu-xing"

export let App = () => Card(
  title: "Welcome",
  description: "Tu × Tailwind × shadcn",
  footer: () => Button(variant: "primary") { "Get started" },
) {
  p {
    "Tu's M6.1 named-arg component calls map cleanly onto shadcn-style "
    Badge(variant: "success") { "props" }
    " — no positional arg footguns."
  }
}
```

## Components

| | Variants | Slots / props |
|---|---|---|
| Button | `primary` / `secondary` / `ghost` / `danger` × `sm` / `md` / `lg` | `onClick`, `disabled`, `children` |
| Input | `sm` / `md` / `lg` | `type`, `placeholder`, `value`, `onInput`, `disabled` |
| Card | — | `title`, `description`, `footer` (slot fn), `children` |
| Badge | `brand` (default) / `success` / `warning` / `danger` / `outline` | `children` |
| Switch | — | `checked`, `onChange` |
| Dialog | — | `open`, `onClose`, `title`, `children` |
| Tabs | — | `items`, `active`, `onSelect` |

## Theme

Override the HSL channels at the document root:

```css
:root {
  --tu-brand: 280 90% 60%;       /* purple instead of indigo */
  --tu-radius: 1rem;             /* rounder corners */
}
```

For light mode, set `data-theme="light"` on `<html>` or any parent — the bundled palette flips automatically.

## Roadmap

- More primitives (Select, Tooltip, Popover, Toast)
- `tu add <component>` CLI for shadcn-style copy-paste install (currently you import from npm)
- Form helpers (Form, Field, Label) once Tu has param destructuring
- A11y: keyboard nav for Tabs / Dialog / Switch (V1 has the basics; full WCAG pending)
