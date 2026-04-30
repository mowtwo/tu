import { compileWithMap } from '@tu-lang/compiler'
import { readFile } from 'node:fs/promises'
import type { Plugin } from 'vite'
import { importedNameKindsFor } from './import-kinds.js'

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
 * import tu from '@tu-lang/vite'
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
      // Resolve cross-`.tu` imports' kinds so a `Signal.State` cell imported
      // from a sibling file still emits `.get()` at the use site (M2.3 fix).
      const importedNameKinds = importedNameKindsFor(src, cleanId)
      // Pass the resolved file path as the filename so compile errors carry
      // a clickable location and the source map's `sources` field resolves
      // back to the original `.tu` file in browser stack traces.
      const { code, map } = compileWithMap(src, {
        filename: cleanId,
        ...(importedNameKinds ? { importedNameKinds } : {}),
      })
      return { code, map }
    },
    handleHotUpdate(ctx) {
      if (!include.test(ctx.file)) return undefined
      // Vite's HMR doesn't automatically drop the cached load() result for
      // a plugin that handled `load` — without this the moduleGraph still
      // serves the previous compile, even across page reload. Force-
      // invalidate so the next request re-reads .tu from disk and re-
      // compiles. (Per-component fine-grained HMR boundaries — keeping
      // component state across the reload — remain future work.)
      for (const mod of ctx.modules) {
        ctx.server.moduleGraph.invalidateModule(mod)
      }
      return ctx.modules
    },
  }
}
