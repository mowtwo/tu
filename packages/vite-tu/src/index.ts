import { compileWithMap } from '@tu/compiler'
import { readFile } from 'node:fs/promises'
import type { Plugin } from 'vite'

export const VERSION = '0.0.0'

export interface TuPluginOptions {
  /**
   * Override file-extension matching. Defaults to `/\.tu$/` — only files
   * ending in `.tu` (no query string fragments) are compiled.
   */
  include?: RegExp
}

/**
 * Vite plugin that compiles Tu source modules on import.
 *
 * Usage:
 * ```ts
 * import tu from '@tu/vite'
 * export default { plugins: [tu()] }
 * ```
 *
 * Wires the Tu compiler into Vite's `load` hook: when the dev server (or
 * build) sees an import resolving to a `.tu` file, this plugin reads it from
 * disk and returns the compiled ESM source. Vite then handles the result
 * exactly like any other JS module — including HMR via full reload on save.
 */
export default function tu(options: TuPluginOptions = {}): Plugin {
  const include = options.include ?? /\.tu$/

  return {
    name: 'vite-tu',
    enforce: 'pre',
    async load(id) {
      // Vite may append `?something` queries to ids; strip before matching
      // so a request for `Foo.tu?import` still hits this plugin.
      const cleanId = id.split('?', 1)[0] ?? id
      if (!include.test(cleanId)) return null
      const src = await readFile(cleanId, 'utf-8')
      // Pass the resolved file path as the filename so compile errors carry
      // a clickable location and the source map's `sources` field resolves
      // back to the original `.tu` file in browser stack traces.
      const { code, map } = compileWithMap(src, { filename: cleanId })
      return { code, map }
    },
    handleHotUpdate(ctx) {
      // Trigger a full module invalidation when a .tu file changes; Vite's
      // default HMR will then re-import via load() and the playground will
      // re-fetch + re-mount. Per-component HMR boundaries are future work.
      if (include.test(ctx.file)) {
        return ctx.modules
      }
      return undefined
    },
  }
}
