// Main build pipeline: read markdown → render via theme → write HTML.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
    const links = (config.stylesheets ?? []).map((href) => ({
      rel: 'stylesheet',
      href: resolveAssetHref(config.base ?? '/', href),
    }))
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
