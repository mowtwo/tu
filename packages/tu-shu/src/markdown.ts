// Markdown → HTML pipeline. Uses markdown-it for parsing + Shiki for code
// blocks. The output HTML is fed into Tu's `$static` vnode (M6.0) so the
// runtime can mount it without re-allocating per render.
import matter from 'gray-matter'
import MarkdownIt from 'markdown-it'
import { createHighlighter, type Highlighter } from 'shiki'

let highlighter: Highlighter | null = null
async function getHighlighter(): Promise<Highlighter> {
  if (!highlighter) {
    highlighter = await createHighlighter({
      themes: ['github-dark'],
      // Common languages plus Tu's grammar — registered separately when
      // the consumer's tu-shu.config provides it; for now bundle a
      // sensible defaults set.
      langs: ['javascript', 'typescript', 'css', 'html', 'json', 'bash', 'shell', 'markdown'],
    })
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
