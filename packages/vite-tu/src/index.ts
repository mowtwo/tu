import { compileBundle, compileWithMap, type BundleResult } from '@tu-lang/compiler'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve as resolvePath } from 'node:path'
import type { Plugin, ResolvedConfig } from 'vite'
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

/**
 * **Tu-as-entry plugin** — lets a Tu file *replace* `index.html` as the
 * Vite project's entry point. Instead of writing a thin HTML shell that
 * loads a JS bundle, the user authors `src/main.tu`, exports `App` (a
 * Tu component), and this plugin generates the surrounding HTML
 * scaffold + mount script automatically.
 *
 * Usage:
 * ```ts
 * import tu, { tuPage } from '@tu-lang/vite'
 *
 * export default defineConfig({
 *   plugins: [tu(), tuPage({ entry: 'src/main.tu', title: 'My App' })],
 * })
 * ```
 *
 * The Tu file must export an `App` component:
 * ```tu
 * export let App = () => h1 { "Hello, Tu!" }
 * ```
 *
 * Optional config knobs:
 *   - `title`     — `<title>` text (default: `'Tu app'`)
 *   - `lang`      — `<html lang>` (default: `'en'`)
 *   - `bodyClass` — class on `<body>`
 *   - `head`      — extra raw HTML injected into `<head>` (e.g. CSS link)
 *   - `mountId`   — id of the mount element (default: `'app'`)
 */
export interface TuPageOptions {
  entry: string
  title?: string
  lang?: string
  bodyClass?: string
  head?: string
  mountId?: string
}

export function tuPage(options: TuPageOptions): Plugin {
  const mountId = options.mountId ?? 'app'
  const title = options.title ?? 'Tu app'
  const lang = options.lang ?? 'en'
  const bodyClass = options.bodyClass ?? ''
  const headRaw = options.head ?? ''
  let resolved: ResolvedConfig | undefined
  // Tracks whether *we* wrote the project-root index.html (vs. the user
  // supplying one). When true we delete it in closeBundle so the project
  // tree stays clean — the file only exists for the duration of `vite
  // build`. (Without this Vite refuses to load any entry; resolveId on
  // `/index.html` fires too late in the pipeline.)
  let weCreatedStub = false

  const entryHtml = (): string =>
    synthesizeEntryHtml({
      entry: options.entry,
      title,
      lang,
      bodyClass,
      headRaw,
      mountId,
    })

  return {
    name: '@tu-lang/vite/page',
    configResolved(c) {
      resolved = c
    },
    // Dev: intercept `/` and `/index.html` and serve the synthesized
    // HTML directly. We can't rely on Vite's transformIndexHtml alone
    // because it still requires the physical file to exist on disk.
    configureServer(server) {
      const html = () => server.transformIndexHtml('/', entryHtml())
      return () => {
        server.middlewares.use(async (req, res, next) => {
          if (!req.url) return next()
          const url = req.url.split('?')[0]
          if (url === '/' || url === '/index.html') {
            try {
              const body = await html()
              res.statusCode = 200
              res.setHeader('Content-Type', 'text/html')
              res.end(body)
              return
            } catch (e) {
              return next(e)
            }
          }
          next()
        })
      }
    },
    // Build: Vite/Rollup resolves `index.html` from disk before any
    // plugin hook fires. Write a placeholder to project root in
    // buildStart so the resolver finds it, then transformIndexHtml
    // replaces the body with the real synthesized scaffold. closeBundle
    // removes the stub so the user's tree stays clean.
    async buildStart() {
      if (resolved?.command !== 'build') return
      const indexPath = resolvePath(resolved.root, 'index.html')
      if (!existsSync(indexPath)) {
        await writeFile(indexPath, entryHtml(), 'utf-8')
        weCreatedStub = true
      }
    },
    transformIndexHtml: {
      order: 'pre',
      handler() {
        return entryHtml()
      },
    },
    async closeBundle() {
      if (!weCreatedStub || !resolved) return
      const indexPath = resolvePath(resolved.root, 'index.html')
      await rm(indexPath, { force: true })
      weCreatedStub = false
    },
  }
}

interface EntryShape {
  entry: string
  title: string
  lang: string
  bodyClass: string
  headRaw: string
  mountId: string
}

function synthesizeEntryHtml(s: EntryShape): string {
  const bodyAttr = s.bodyClass ? ` class="${escapeHtmlAttr(s.bodyClass)}"` : ''
  const entryUrl = '/' + s.entry.replace(/^\.?\/?/, '')
  return `<!doctype html>
<html lang="${escapeHtmlAttr(s.lang)}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtmlText(s.title)}</title>
    ${s.headRaw}
  </head>
  <body${bodyAttr}>
    <div id="${escapeHtmlAttr(s.mountId)}"></div>
    <script type="module">
      import { mount } from '@tu-lang/dom'
      import { App } from '${entryUrl}'
      mount(() => App(), document.getElementById('${escapeHtmlAttr(s.mountId)}'))
    </script>
  </body>
</html>`
}

function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function escapeHtmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ── M8 Phase 6 — `tuBundle()` plugin (cross-module canonicalize) ────

export interface TuBundleOptions {
  /** Project root to scan for .tu files. Defaults to Vite's resolved root. */
  root?: string
  /** Extra dirs to skip during scan. `node_modules` + `dist` are always skipped. */
  skip?: ReadonlyArray<string>
  /** When true, also enable canonicalize in dev mode (re-scans on file save).
   *  Defaults to false — dev mode falls back to per-file emit, which is
   *  fast and avoids the scan-on-every-save cost. */
  dev?: boolean
}

/**
 * **Tu cross-module canonicalize plugin** — pairs with the base `tu()`
 * plugin to enable M8 Phase 6's bundle-mode emit. At build start (and
 * optionally on every dev save) the plugin walks the project's `.tu`
 * files, runs `compileBundle()`, and serves:
 *
 *   - The shared `__tu_types.generated.ts` virtual module (one
 *     `export const T_HASH = type.struct(…)` per merged shape).
 *   - Per-file outputs whose interface decls + anon synth references
 *     import from the shared module instead of redeclaring locally.
 *
 * Production wins: smaller bundle (deduped descriptors), faster
 * compile (no redundant struct construction), runtime descriptor
 * reference equality across files (`type.of(x) === type.of(y)` for
 * same shapes).
 *
 * Usage:
 * ```ts
 * import tu, { tuBundle } from '@tu-lang/vite'
 *
 * export default defineConfig({
 *   plugins: [tu(), tuBundle()],
 * })
 * ```
 *
 * The plugin sits AFTER `tu()` so its `load` hook handler wins for
 * .tu files when canonicalize is active. When canonicalize is off
 * (dev mode without `dev: true`), the base `tu()` plugin's per-file
 * emit handles loads as before.
 */
export function tuBundle(options: TuBundleOptions = {}): Plugin {
  const skip = new Set(['node_modules', 'dist', '.git', '.tu-out', ...(options.skip ?? [])])
  let resolved: ResolvedConfig | undefined
  let bundle: BundleResult | null = null
  let isDev = false

  // Virtual module IDs follow Vite's `\0`-prefix convention so other
  // plugins know to skip resolution.
  const SHARED_ID_PUBLIC = './__tu_types.generated.js'
  const SHARED_ID_INTERNAL = '\0__tu_types.generated.js'

  async function rebuild(): Promise<void> {
    const root = options.root ?? resolved?.root ?? process.cwd()
    const files = scanTuFiles(root, skip)
    if (files.length === 0) {
      bundle = null
      return
    }
    const inputs = await Promise.all(
      files.map(async (f) => ({ filename: f, source: await readFile(f, 'utf-8') }))
    )
    bundle = compileBundle(inputs, {
      sharedImportPath: SHARED_ID_PUBLIC,
      emitTS: false,
    })
  }

  return {
    name: 'vite-tu-bundle',
    enforce: 'pre',
    configResolved(c) {
      resolved = c
      isDev = c.command === 'serve'
    },
    async buildStart() {
      // Skip dev mode unless opted in — the per-file path in `tu()`
      // covers it and avoids the scan cost.
      if (isDev && !options.dev) {
        bundle = null
        return
      }
      await rebuild()
    },
    resolveId(id) {
      // The per-file emit imports from `./__tu_types.generated.js`.
      // We resolve it (relative or bare) to our internal virtual id.
      if (
        id === SHARED_ID_PUBLIC ||
        id === '__tu_types.generated.js' ||
        id === SHARED_ID_INTERNAL ||
        id.endsWith('/__tu_types.generated.js')
      ) {
        return SHARED_ID_INTERNAL
      }
      return null
    },
    load(id) {
      if (id === SHARED_ID_INTERNAL) {
        return bundle?.sharedModule.code ?? null
      }
      const cleanId = id.split('?', 1)[0] ?? id
      if (!cleanId.endsWith('.tu')) return null
      const fileResult = bundle?.files.get(cleanId)
      if (!fileResult) return null
      // Stripping the source-map suffix would lose the inline map;
      // Vite consumes the `map` property separately.
      return { code: fileResult.code, map: fileResult.map }
    },
    handleHotUpdate(ctx) {
      if (!ctx.file.endsWith('.tu')) return undefined
      // Dev-mode rebuild: re-canonicalize on every .tu save when
      // `dev: true` is set. Cheap because the file count is small in
      // practice; expensive projects can keep dev=false (default) and
      // pay the canonical cost only at production build.
      if (isDev && options.dev) {
        void rebuild()
      }
      return undefined
    },
  }
}

/** Recursively list every `.tu` file under `root`, skipping common
 *  build / vendor dirs. Synchronous to keep startup straightforward. */
function scanTuFiles(root: string, skip: ReadonlySet<string>): string[] {
  const out: string[] = []
  const queue: string[] = [root]
  while (queue.length > 0) {
    const dir = queue.shift()!
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of names) {
      if (skip.has(name)) continue
      if (name.startsWith('.tu-')) continue // generated dirs
      const path = join(dir, name)
      let s
      try {
        s = statSync(path)
      } catch {
        continue
      }
      if (s.isDirectory()) {
        queue.push(path)
      } else if (s.isFile() && name.endsWith('.tu')) {
        out.push(path)
      }
    }
  }
  // Stable sort for deterministic canonical-name ordering across builds.
  return out.sort()
}
