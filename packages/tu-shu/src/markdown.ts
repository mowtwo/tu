// Markdown → HTML pipeline. Uses markdown-it for parsing + Shiki for code
// blocks. Tu's TextMate grammar is registered alongside the standard
// langs so ```tu code blocks highlight on the rendered site.
import matter from 'gray-matter'
import MarkdownIt from 'markdown-it'
import { createHighlighter, type Highlighter } from 'shiki'
import type { LanguageRegistration } from '@shikijs/types'

/**
 * Tu's TextMate grammar — same JSON the vscode-tu extension uses. Shiki
 * happily consumes the file, but the field shapes need a small
 * `name: 'tu'` patch (the grammar's source `name` is "Tu" capitalized,
 * which Shiki reads as the language name and breaks alias resolution).
 */
async function loadTuGrammar(): Promise<LanguageRegistration | null> {
  // Resolve relative to this module: tu-shu publishes its dist under
  // packages/tu-shu/dist/, vscode-tu lives at packages/vscode/syntaxes.
  // In an npm-installed project the grammar JSON isn't bundled (vscode
  // is a private workspace package); we just fall back to txt for `tu`
  // blocks. The grammar can be overridden by consumers via a future
  // config option.
  try {
    const { readFile } = await import('node:fs/promises')
    const url = new URL('../../vscode/syntaxes/tu.tmLanguage.json', import.meta.url)
    const text = await readFile(url, 'utf-8')
    const json = JSON.parse(text) as Record<string, unknown>
    return { ...json, name: 'tu' } as unknown as LanguageRegistration
  } catch {
    return null
  }
}

let highlighter: Highlighter | null = null
async function getHighlighter(): Promise<Highlighter> {
  if (!highlighter) {
    const baseLangs = ['javascript', 'typescript', 'css', 'html', 'json', 'bash', 'shell', 'markdown', 'yaml', 'tsx', 'jsx']
    highlighter = await createHighlighter({
      themes: ['github-dark'],
      langs: baseLangs,
    })
    // Register Tu's grammar separately (LanguageRegistration shape isn't
    // a string, so it goes via loadLanguage).
    const tu = await loadTuGrammar()
    if (tu) {
      try {
        await highlighter.loadLanguage(tu)
      } catch {
        // Grammar load failure is non-fatal — `tu` blocks fall back to txt.
      }
    }
  }
  return highlighter
}

let mdInstance: MarkdownIt | null = null
async function getMd(): Promise<MarkdownIt> {
  if (!mdInstance) {
    const hi = await getHighlighter()
    mdInstance = new MarkdownIt({
      html: true,
      linkify: true,
      typographer: true,
      highlight(code, lang) {
        try {
          if (!lang) return ''
          return hi.codeToHtml(code, { lang, theme: 'github-dark' })
        } catch {
          return ''
        }
      },
    })
  }
  return mdInstance
}

export interface ParsedMarkdown {
  html: string
  frontmatter: Record<string, unknown>
  title: string
}

/**
 * Parse a markdown source string into HTML + frontmatter. The first
 * `# Heading` (or the frontmatter `title` field) drives the page title.
 */
export async function parseMarkdown(source: string): Promise<ParsedMarkdown> {
  const parsed = matter(source)
  const md = await getMd()
  const html = md.render(parsed.content)
  const fm = parsed.data as Record<string, unknown>
  let title = ''
  if (typeof fm.title === 'string') {
    title = fm.title
  } else {
    const h1 = parsed.content.match(/^#\s+(.+)$/m)
    if (h1) title = h1[1]!.trim()
  }
  return { html, frontmatter: fm, title }
}
