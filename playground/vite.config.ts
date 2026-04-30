import { defineConfig } from 'vite'
import tu from '@tu/vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')

export default defineConfig({
  plugins: [tu()],
  server: {
    fs: {
      // The playground imports `.tu` source files from sibling
      // `examples/*/` directories — let Vite serve files from anywhere
      // under the repo root, not just `playground/`.
      allow: [repoRoot],
    },
  },
})
