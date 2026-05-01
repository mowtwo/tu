import tu, { tuPage } from '@tu-lang/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    tu(),
    // Generates index.html from src/main.tu's exported `App`.
    // No HTML scaffolding, no JS bootstrap — just `src/main.tu`.
    tuPage({
      entry: 'src/main.tu',
      title: 'Tu app — entry',
      bodyClass: 'm-0 font-sans bg-slate-950 text-slate-100',
      head: `<style>body { font-family: system-ui, -apple-system, sans-serif; }</style>`,
    }),
  ],
})
