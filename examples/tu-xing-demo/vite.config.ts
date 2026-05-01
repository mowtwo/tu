import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import tu from '@tu-lang/vite'

export default defineConfig({
  // CI sets `TU_BASE='/tu/tu-xing-preview/'` when deploying as a
  // sub-route under the docs site. Local `pnpm dev` keeps the default.
  base: process.env.TU_BASE ?? '/',
  plugins: [tu(), tailwindcss()],
})
