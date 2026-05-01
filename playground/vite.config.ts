import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import tu from '@tu-lang/vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')

export default defineConfig({
  // CI sets `TU_BASE=/tu/playground/` when staging the playground under
  // the docs site at https://mowtwo.github.io/tu/playground/. Local
  // `pnpm dev` keeps the default `/`.
  base: process.env.TU_BASE ?? '/',
  plugins: [tu(), tailwindcss()],
  server: {
    fs: {
      // The playground imports `.tu` source files from sibling
      // `examples/*/` directories AND from `packages/tu-xing/` — let
      // Vite serve files from anywhere under the repo root, not just
      // `playground/`.
      allow: [repoRoot],
    },
  },
})
