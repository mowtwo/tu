# Tu × Tailwind

Tu compiles `class:` props to standard HTML `class` attributes, so any utility-CSS framework that scans content for class strings works out of the box. Tailwind v4's `@source` directive is all you need.

## Setup

```sh
pnpm add -D tailwindcss @tailwindcss/vite
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

In your entry CSS:

```css
@import "tailwindcss";
@source "./**/*.tu";
```

That's it. No PostCSS config, no purge list maintenance, no framework-specific plugin. Tu emits standard HTML strings that Tailwind's content scanner picks up.

## Use

```tu
export let App = () => div(class: "max-w-2xl mx-auto p-8 space-y-6") {
  header {
    h1(class: "text-4xl font-bold tracking-tight bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent") {
      "Tu × Tailwind"
    }
  }

  button(
    class: "px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white font-medium transition-colors",
    onClick: () => count = count + 1,
  ) { "+1" }
}
```

## Coexistence with `style { … }` blocks

Tailwind utilities and Tu's scoped style blocks compose freely on the same element:

```tu
.badge() {
  span(class: "inline-flex items-center gap-2") {
    span(class: "w-2 h-2 rounded-full bg-emerald-400 animate-pulse")
    "Live reactive"
  }

  style {
    .badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border: 1px solid rgba(110, 231, 183, 0.3);
      border-radius: 9999px;
    }
  }
}
```

The `.badge` ClassRef gets the per-component hash (M5/F dual-class injection), Tailwind utilities get included by the content scanner, and they sit side by side on the rendered element.

## With tu-xing

If you want **theme tokens + ready-made primitives**, layer `@tu-lang/tu-xing` on top — it's Tailwind-driven internally and exposes HSL CSS variables for retheming. See [tu-xing](./tu-xing) for the install steps.

## Live demo

Run `pnpm --filter tu-playground dev`, switch to the **Tailwind** demo in the sidebar.
