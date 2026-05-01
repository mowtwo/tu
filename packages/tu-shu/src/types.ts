// tu-shu config + page model.

export interface TuShuConfig {
  /** Site title — emitted as `<title>` and the default brand text. */
  title?: string
  /** Site-wide description for meta tags. */
  description?: string
  /** Where to find markdown source files. Defaults to `'./docs'`. */
  srcDir?: string
  /** Where to write the static build. Defaults to `'./.tu-shu/dist'`. */
  outDir?: string
  /** Base path for the deployed site (e.g. `/myrepo/`). Defaults to `/`. */
  base?: string
  /** Top-level navigation links. */
  nav?: NavItem[]
  /** Sidebar — by default the site renders a flat list of pages. */
  sidebar?: SidebarSection[]
  /** Lang attribute for `<html>`. Defaults to `'en'`. */
  lang?: string
  /**
   * Stylesheets to `<link>` into every page's head. Use this to load
   * Tailwind output, `@tu-lang/tu-xing/theme.css`, or any custom theme
   * the site needs. Supports absolute URLs, root-relative paths, or
   * `base`-relative paths (the build path-joins them with `config.base`).
   */
  stylesheets?: string[]
  /**
   * Scripts to `<script>` into every page's head. Useful for analytics
   * or per-page hydration entries.
   */
  scripts?: Array<{
    src?: string
    type?: 'module' | 'text/javascript' | 'importmap'
    defer?: boolean
    async?: boolean
    body?: string
  }>
}

export interface NavItem {
  text: string
  link: string
}

export interface SidebarSection {
  text: string
  items: SidebarItem[]
}

export interface SidebarItem {
  text: string
  link: string
}

export interface Page {
  /** Path relative to srcDir, e.g. `'index.md'` or `'guide/intro.md'`. */
  src: string
  /** URL path the page should live at, e.g. `'/'` or `'/guide/intro'`. */
  url: string
  /** Compiled HTML body (the markdown content rendered to HTML). */
  html: string
  /** Frontmatter from gray-matter. */
  frontmatter: Record<string, unknown>
  /** First H1 / frontmatter title. */
  title: string
}
