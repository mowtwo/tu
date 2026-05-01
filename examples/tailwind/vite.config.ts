import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import tu, { tuPage } from '@tu-lang/vite'

export default defineConfig({
  plugins: [
    tu(),
    tailwindcss(),
    tuPage({
      entry: 'src/App.tu',
      title: 'Tu × Tailwind v4',
      lang: 'en',
      bodyClass: 'min-h-screen bg-slate-950 text-slate-100',
      head: '<link rel="stylesheet" href="/src/styles.css" />',
    }),
  ],
})
