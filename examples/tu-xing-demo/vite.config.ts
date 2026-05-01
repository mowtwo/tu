import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import tu, { tuPage } from '@tu-lang/vite'

export default defineConfig({
  // CI sets `TU_BASE='/tu/tu-xing-preview/'` when deploying as a
  // sub-route under the docs site. Local `pnpm dev` keeps the default.
  base: process.env.TU_BASE ?? '/',
  plugins: [
    tu(),
    tailwindcss(),
    // Tu file is the entry — no index.html, no main.js shim. The plugin
    // synthesizes the HTML scaffold and mounts the exported `App`.
    tuPage({
      entry: 'src/App.tu',
      title: 'tu-xing — preview',
      lang: 'en',
      bodyClass: 'min-h-screen bg-[hsl(var(--tu-bg))] text-[hsl(var(--tu-fg))]',
      head: '<link rel="icon" type="image/svg+xml" href="./favicon.svg" />\n<link rel="stylesheet" href="/src/styles.css" />',
    }),
  ],
})
