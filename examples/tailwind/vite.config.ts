import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import tu from '@tu-lang/vite'

export default defineConfig({
  plugins: [tu(), tailwindcss()],
})
