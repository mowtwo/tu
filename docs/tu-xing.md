# tu-xing (图形)

A Tu-native UI component library — shadcn + baseui style. Tailwind-driven primitives with theme tokens. Source-only package.

> Published as [`@tu-lang/tu-xing`](https://www.npmjs.com/package/@tu-lang/tu-xing) on npm. Live demo: [Playground → tu-xing](https://mowtwo.github.io/tu/playground#tu-xing).

## What's in V1

Seven primitives:

| Component | Variants / shapes | Uses |
|---|---|---|
| `Button` | `primary` / `secondary` / `ghost` / `danger` × `sm` / `md` / `lg` | `onClick`, `disabled`, `children` |
| `Input` | `sm` / `md` / `lg` | `type`, `placeholder`, `value`, `onInput`, `disabled` |
| `Card` | — | `title`, `description`, `footer` (slot fn), `children` |
| `Badge` | `brand` / `success` / `warning` / `danger` / `outline` | `children` |
| `Switch` | — | `checked`, `onChange` |
| `Dialog` | — | `open`, `onClose`, `title`, `children` |
| `Tabs` | — | `items`, `active`, `onSelect` |

## Style philosophy

- **shadcn-like**: every component is a single `.tu` file. Source-only — consumers import via `@tu-lang/vite`. Easy to fork into your own project.
- **baseui-like**: theme tokens live in `theme.css` as HSL CSS variables (`--tu-brand`, `--tu-surface`, …). Override at the document root to retheme. Light + dark palettes ship by default.
- **Tailwind-driven**: every component uses Tailwind utility classes referencing the theme tokens via `bg-[hsl(var(--tu-brand))]` and friends.

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
@source "../node_modules/@tu-lang/tu-xing/src";
```

In your Vite config:

```ts
import tailwindcss from '@tailwindcss/vite'
import tu from '@tu-lang/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [tu(), tailwindcss()],
})
```

## Use

```tu
import { Button } from "@tu-lang/tu-xing/Button.tu"
import { Card } from "@tu-lang/tu-xing/Card.tu"
import { Badge } from "@tu-lang/tu-xing/Badge.tu"

export let App = () => Card(
  title: "Welcome",
  description: "Tu × Tailwind × shadcn",
  footer: () => Button(variant: "primary") { "Get started" },
) {
  p {
    "Built with Tu's M6.1 named-arg components — props default optional. "
    Badge(variant: "success") { "stable" }
  }
}
```

## Theme

Override the HSL channels at the document root:

```css
:root {
  --tu-brand: 280 90% 60%;       /* purple instead of indigo */
  --tu-radius: 1rem;             /* rounder corners */
}
```

For light mode, set `data-theme="light"` on `<html>` or any parent.

## Roadmap

- More primitives (Select, Tooltip, Popover, Toast)
- `tu add <component>` CLI for shadcn-style copy-paste install
- Form helpers (Form, Field, Label) once Tu has param destructuring
- Full WCAG keyboard nav for Tabs / Dialog / Switch
