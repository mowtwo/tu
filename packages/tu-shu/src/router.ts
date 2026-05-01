// File-system → URL routing. Walks `srcDir` recursively, finds every
// .md file, and returns the page list with both source path and final
// URL. Conventions:
//   docs/index.md     → /
//   docs/guide.md     → /guide
//   docs/guide/x.md   → /guide/x
//   docs/foo/index.md → /foo/
import { readdirSync, statSync } from 'node:fs'
import { join, posix, relative, sep } from 'node:path'

export interface RoutedFile {
  /** Source path absolute on disk. */
  abs: string
  /** Path relative to srcDir, using forward slashes. */
  rel: string
  /** Final URL the page should live at. */
  url: string
}

export function discoverPages(srcDir: string, exclude: string[] = []): RoutedFile[] {
  const out: RoutedFile[] = []
  walk(srcDir, srcDir, out, exclude)
  return out.sort((a, b) => a.url.localeCompare(b.url))
}

function walk(root: string, dir: string, out: RoutedFile[], exclude: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue
    if (name === 'node_modules') continue
    const abs = join(dir, name)
    const stat = statSync(abs)
    if (stat.isDirectory()) {
      walk(root, abs, out, exclude)
      continue
    }
    if (!name.endsWith('.md')) continue
    const rel = relative(root, abs).split(sep).join(posix.sep)
    if (exclude.some((pat) => rel.includes(pat))) continue
    out.push({ abs, rel, url: relToUrl(rel) })
  }
}

function relToUrl(rel: string): string {
  let p = rel.replace(/\.md$/, '')
  if (p === 'index') return '/'
  if (p.endsWith('/index')) return '/' + p.slice(0, -'/index'.length) + '/'
  return '/' + p
}
