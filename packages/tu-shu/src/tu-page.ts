// .tu page loader — compile a Tu source file, execute it in-process,
// invoke the exported `Page` component, and render the resulting vnode
// to an HTML string. The exported `frontmatter` constant (if any)
// drives title / layout / hero / features the same way YAML
// frontmatter does for plain markdown pages.
//
// This is the path that lets the docs site dogfood Tu end-to-end —
// every .tu page can mix `markdown { … }` prose with real Tu
// components (interactive demos, scoped styles, reactive state).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compile, setMarkdownHighlight } from '@tu-lang/compiler'
import { renderToStringAsync } from '@tu-lang/runtime'
import { getMarkdownItHighlighter } from './markdown.js'

// Wire tu-shu's Shiki highlighter into the compiler's markdown { … }
// emit so code blocks INSIDE Tu source get the same colorization as
// markdown blocks rendered from .md files. Once-only setup;
// markdown-it singleton in the compiler picks up the function on
// first use.
let injected = false
async function ensureMarkdownHighlightInjected(): Promise<void> {
  if (injected) return
  const fn = await getMarkdownItHighlighter()
  if (fn) setMarkdownHighlight(fn)
  injected = true
}

export interface LoadedTuPage {
  html: string
  frontmatter: Record<string, unknown>
  title: string
}

/**
 * Compile + execute a `.tu` source file, returning the rendered HTML
 * plus any frontmatter the file exported.
 *
 * The compiled JS is written to a temp `.mjs` next to the source so a
 * dynamic `import()` can resolve it. Cache busts via timestamp so
 * subsequent rebuilds pick up edits.
 */
export async function loadTuPage(absPath: string): Promise<LoadedTuPage> {
  await ensureMarkdownHighlightInjected()
  const source = readFileSync(absPath, 'utf-8')
  const js = compile(source)
  // Stage compiled output next to the source for clean `import()`.
  const tmpPath = resolve(
    dirname(absPath),
    `.tu-shu/${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`
  )
  mkdirSync(dirname(tmpPath), { recursive: true })
  writeFileSync(tmpPath, js)

  const mod = (await import(pathToFileURL(tmpPath).href)) as Record<string, unknown>

  // Frontmatter export is a Signal.State because top-level `let` cells
  // wrap. Read via `.get()` if it's a cell; accept plain objects too.
  let frontmatter: Record<string, unknown> = {}
  const fmExport = mod['frontmatter']
  if (fmExport && typeof fmExport === 'object') {
    if ('get' in fmExport && typeof (fmExport as { get?: unknown }).get === 'function') {
      const v = (fmExport as { get(): unknown }).get()
      if (v && typeof v === 'object') frontmatter = v as Record<string, unknown>
    } else {
      frontmatter = fmExport as Record<string, unknown>
    }
  }

  const Page = mod['Page'] as undefined | (() => unknown)
  if (typeof Page !== 'function') {
    throw new Error(`tu-shu: .tu page must export \`Page\` component (in ${absPath})`)
  }
  // Page may be sync or async — Tu's M6.6 added async lambdas, and
  // M6.11 (#60) extended the renderer to await Promise children.
  // `renderToStringAsync` accepts both shapes.
  const vnode = Page()
  const html = await renderToStringAsync(vnode as never)

  // Title precedence: explicit frontmatter.title > inferred from any
  // <h1> in the rendered HTML.
  let title = ''
  if (typeof frontmatter['title'] === 'string') {
    title = frontmatter['title'] as string
  } else {
    const m = html.match(/<h1[^>]*>([^<]*)<\/h1>/)
    if (m) title = m[1]!.trim()
  }
  return { html, frontmatter, title }
}
