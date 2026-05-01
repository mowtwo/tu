// Main build pipeline: read markdown → render via theme → write HTML +
// copy static assets from publicDir.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { renderPageHtml } from '@tu-lang/runtime'
import { parseMarkdown } from './markdown.js'
import { discoverPages } from './router.js'
import { renderTheme } from './theme/default.js'
import type { Page, TuShuConfig } from './types.js'

export async function build(cwd: string, config: TuShuConfig): Promise<void> {
  const srcDir = resolve(cwd, config.srcDir ?? 'docs')
  const outDir = resolve(cwd, config.outDir ?? '.tu-shu/dist')

  console.log(`tu-shu: building ${srcDir} → ${outDir}`)

  const files = discoverPages(srcDir, config.srcExclude)
  console.log(`tu-shu: found ${files.length} markdown files`)

  for (const file of files) {
    const source = readFileSync(file.abs, 'utf-8')
    const md = await parseMarkdown(source)
    const page: Page = {
      src: file.rel,
      url: file.url,
      html: md.html,
      frontmatter: md.frontmatter,
      title: md.title,
    }
    const themed = renderTheme(page, config)
    const baseHref = config.base ?? '/'
    const links: Array<Record<string, string>> = []
    if (config.favicon) {
      const href = resolveAssetHref(baseHref, config.favicon)
      // Pick a sensible MIME type from the file extension; fall back
      // to image/x-icon for .ico, image/svg+xml for SVG.
      const type = config.favicon.endsWith('.svg')
        ? 'image/svg+xml'
        : config.favicon.endsWith('.png')
          ? 'image/png'
          : config.favicon.endsWith('.ico')
            ? 'image/x-icon'
            : undefined
      const link: Record<string, string> = { rel: 'icon', href }
      if (type) link.type = type
      links.push(link)
    }
    for (const href of config.stylesheets ?? []) {
      links.push({ rel: 'stylesheet', href: resolveAssetHref(baseHref, href) })
    }
    const html = renderPageHtml(themed.body, {
      lang: config.lang ?? 'en',
      title: page.title
        ? `${page.title} | ${config.title ?? ''}`.replace(/ \| $/, '')
        : config.title,
      meta: config.description ? { description: config.description } : undefined,
      links,
      scripts: config.scripts,
      headRaw: themed.head,
      bodyClass: 'min-h-screen bg-[hsl(var(--tu-bg))] text-[hsl(var(--tu-fg))]',
    })

    const outPath = urlToFsPath(outDir, file.url)
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, html)
    console.log(`  ${file.url}  →  ${outPath.slice(outDir.length + 1)}`)
  }

  // Copy publicDir contents into outDir verbatim (favicons, downloads,
  // sitemaps, llms.txt — anything that should ship as-is alongside the
  // rendered HTML).
  if (config.publicDir) {
    const pubDir = resolve(cwd, config.publicDir)
    if (existsSync(pubDir)) {
      cpSync(pubDir, outDir, { recursive: true })
      console.log(`tu-shu: copied ${config.publicDir}/ → outDir`)
    }
  }

  console.log(`tu-shu: done — ${files.length} page(s) written`)
}

function urlToFsPath(outDir: string, url: string): string {
  if (url === '/') return join(outDir, 'index.html')
  if (url.endsWith('/')) return join(outDir, url, 'index.html')
  return join(outDir, url + '.html')
}

function resolveAssetHref(base: string, href: string): string {
  if (
    href.startsWith('http://') ||
    href.startsWith('https://') ||
    href.startsWith('//') ||
    href.startsWith('data:')
  ) {
    return href
  }
  if (href.startsWith('/')) return href
  // Treat as base-relative.
  if (base.endsWith('/')) return base + href
  return base + '/' + href
}
