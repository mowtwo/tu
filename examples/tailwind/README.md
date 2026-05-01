# tailwind

Tu + Tailwind v4 — utility-first styling alongside Tu's scoped style blocks.

## What's wired up

- `@tailwindcss/vite` PostCSS plugin runs alongside `@tu-lang/vite`.
- `@source "./**/*.tu"` in `src/styles.css` tells Tailwind to scan Tu source files for class usage (Tailwind v4's default content list is `.html` / `.js` / `.ts` / `.jsx` / `.tsx`, missing `.tu`).
- The demo `App.tu` mixes Tailwind utility classes (`class: "px-4 py-2"`), pug-shorthand pug-scoped classes (`.badge() { … }`), and an inline `style { … }` block. All three coexist.

## Run it

```sh
pnpm install
pnpm dev
```

Open the printed URL. The counter button uses Tailwind utilities for color/transition; the live badge uses a Tu scoped style block; both reactive on the `count` cell.

## Setup in your own project

1. Add Tailwind v4 + the Vite plugin:
   ```sh
   pnpm add -D tailwindcss @tailwindcss/vite
   ```
2. Add to `vite.config.ts`:
   ```ts
   import tailwindcss from '@tailwindcss/vite'
   import tu from '@tu-lang/vite'
   export default defineConfig({ plugins: [tu(), tailwindcss()] })
   ```
3. In your entry CSS:
   ```css
   @import "tailwindcss";
   @source "./**/*.tu";
   ```
4. Use utilities anywhere a string class is expected: `class: "px-4 py-2"`. Tu compiles this to a regular HTML `class` attribute, Tailwind sees it during the content scan.

That's it — no PostCSS config needed.
