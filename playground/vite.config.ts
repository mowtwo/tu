import tailwindcss from '@tailwindcss/vite'
import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import tu from '@tu-lang/vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const demoRoutes = [
  'hello',
  'counter',
  'todo',
  'card',
  'clicker',
  'scoped',
  'composition',
  'typed',
  'tu-xing',
  'tailwind',
  'diff',
  'live',
]

function spaFallback(): Plugin {
  return {
    name: 'tu-playground-spa-fallback',
    closeBundle() {
      const index = join(here, 'dist', 'index.html')
      copyFileSync(index, join(here, 'dist', '404.html'))
      for (const route of demoRoutes) {
        const dir = join(here, 'dist', route)
        mkdirSync(dir, { recursive: true })
        copyFileSync(index, join(dir, 'index.html'))
      }
    },
  }
}

export default defineConfig({
  // CI sets `TU_BASE=/tu/playground/` when staging the playground under
  // the docs site at https://mowtwo.github.io/tu/playground/. Local
  // `pnpm dev` keeps the default `/`.
  base: process.env.TU_BASE ?? '/',
  plugins: [tu(), tailwindcss(), spaFallback()],
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
