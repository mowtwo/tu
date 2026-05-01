// Default tu-shu theme — pure-string HTML assembly. Mirrors VitePress's
// shape: top nav, optional sidebar, main content. Hero / feature-grid
// landing layout when frontmatter says `layout: home`.
//
// Visuals come from inline CSS rules tied to the @tu-lang/tu-xing HSL
// tokens — consumers can override the tokens at the document root and
// the entire theme rethemes. No Tailwind dependency for the theme
// itself; consumers can layer Tailwind on top via config.stylesheets.

import type { NavItem, Page, SidebarSection, TuShuConfig } from '../types.js'

export function renderTheme(
  page: Page,
  config: TuShuConfig
): { head: string; body: string } {
  const base = config.base ?? '/'
  const nav = config.nav ?? []
  const sidebar = config.sidebar ?? []
  const head = THEME_INLINE_STYLE
  const isHome = page.frontmatter['layout'] === 'home'
  const body =
    `<div class="tu-shu-app">` +
    renderNavBar(config.title ?? '', nav, base) +
    (isHome
      ? renderHomeLayout(page, config)
      : renderDocLayout(page, config, sidebar, base))
    +
    `</div>`
  return { head, body }
}

function renderDocLayout(
  page: Page,
  _config: TuShuConfig,
  sidebar: SidebarSection[],
  base: string
): string {
  return (
    `<div class="tu-shu-doc">` +
    (sidebar.length > 0 ? renderSidebar(sidebar, base, page.url) : '') +
    `<main class="tu-shu-content">` +
    `<article class="tu-shu-prose">` +
    page.html +
    `</article>` +
    `</main></div>`
  )
}

function renderHomeLayout(page: Page, config: TuShuConfig): string {
  const fm = page.frontmatter
  const hero = (fm['hero'] ?? {}) as {
    name?: string
    text?: string
    tagline?: string
    actions?: Array<{ theme?: string; text?: string; link?: string }>
  }
  const features = (fm['features'] ?? []) as Array<{
    title?: string
    details?: string
  }>
  const base = config.base ?? '/'

  let body = `<main class="tu-shu-home">`
  if (hero.name || hero.text || hero.tagline) {
    body += `<section class="tu-shu-hero">`
    body += `<h1 class="tu-shu-hero-title">`
    if (hero.name) body += `<span class="tu-shu-hero-name">${escText(hero.name)}</span>`
    if (hero.text) body += ` <span class="tu-shu-hero-text">${escText(hero.text)}</span>`
    body += `</h1>`
    if (hero.tagline) body += `<p class="tu-shu-hero-tagline">${escText(hero.tagline)}</p>`
    if (hero.actions && hero.actions.length > 0) {
      body += `<div class="tu-shu-hero-actions">`
      for (const a of hero.actions) {
        const theme = a.theme === 'brand' ? 'brand' : 'alt'
        body += `<a class="tu-shu-action tu-shu-action-${theme}" href="${escAttr(joinUrl(base, a.link ?? '#'))}">${escText(a.text ?? '')}</a>`
      }
      body += `</div>`
    }
    body += `</section>`
  }
  if (features.length > 0) {
    body += `<section class="tu-shu-features">`
    for (const f of features) {
      body += `<article class="tu-shu-feature">`
      if (f.title) body += `<h3>${escText(f.title)}</h3>`
      if (f.details) body += `<div class="tu-shu-feature-body">${f.details}</div>`
      body += `</article>`
    }
    body += `</section>`
  }
  // Allow markdown body content to follow the frontmatter-driven hero.
  if (page.html.trim()) body += `<article class="tu-shu-prose">${page.html}</article>`
  body += `</main>`
  return body
}

function renderNavBar(title: string, items: NavItem[], base: string): string {
  let html =
    `<header class="tu-shu-nav">` +
    `<div class="tu-shu-nav-inner">` +
    `<a class="tu-shu-brand" href="${escAttr(base)}">${escText(title)}</a>` +
    `<nav class="tu-shu-nav-links">`
  for (const it of items) {
    html += `<a href="${escAttr(joinUrl(base, it.link))}">${escText(it.text)}</a>`
  }
  html +=
    `</nav>` +
    // Hamburger toggle — visible only on narrow screens, drives a
    // data-menu attribute on <body> via the inline script in
    // THEME_INLINE_STYLE so the sidebar slides in.
    `<button class="tu-shu-hamburger" aria-label="Open menu" type="button" onclick="document.body.dataset.menu = document.body.dataset.menu === 'open' ? '' : 'open'">` +
    `<span></span><span></span><span></span>` +
    `</button>` +
    `</div></header>`
  return html
}

function renderSidebar(sections: SidebarSection[], base: string, currentUrl: string): string {
  let html = `<aside class="tu-shu-sidebar">`
  for (const sec of sections) {
    html += `<div class="tu-shu-sidebar-group">`
    html += `<h3>${escText(sec.text)}</h3>`
    html += `<ul>`
    for (const it of sec.items) {
      const active = it.link === currentUrl
      html += `<li><a class="${active ? 'is-active' : ''}" href="${escAttr(joinUrl(base, it.link))}">${escText(it.text)}</a></li>`
    }
    html += `</ul></div>`
  }
  html += `</aside>`
  return html
}

function joinUrl(base: string, link: string): string {
  if (link.startsWith('http://') || link.startsWith('https://')) return link
  if (base.endsWith('/') && link.startsWith('/')) return base + link.slice(1)
  if (!base.endsWith('/') && !link.startsWith('/')) return base + '/' + link
  return base + link
}

function escText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

// Hand-rolled CSS for the default theme. Tied to @tu-lang/tu-xing HSL
// tokens — themes auto-flip between dark and light when consumers
// override the tokens. Inline so no extra HTTP request is needed and
// users can use tu-shu without any external CSS pipeline.
const THEME_INLINE_STYLE = `<style>
:root {
  /* Fallback tokens — overridden when @tu-lang/tu-xing/theme.css is
     also loaded via config.stylesheets. */
  --tu-bg: 222 47% 7%;
  --tu-surface: 222 47% 11%;
  --tu-surface-elevated: 222 47% 15%;
  --tu-border: 222 30% 22%;
  --tu-fg: 220 14% 96%;
  --tu-fg-muted: 220 9% 65%;
  --tu-brand: 239 84% 67%;
  --tu-brand-fg: 220 14% 99%;
  --tu-brand-hover: 239 84% 75%;
  --tu-radius-sm: 0.375rem;
  --tu-radius: 0.5rem;
  --tu-radius-lg: 0.75rem;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-feature-settings: 'cv11';
  color-scheme: dark;
}
* { box-sizing: border-box; }
body { margin: 0; background: hsl(var(--tu-bg)); color: hsl(var(--tu-fg)); -webkit-font-smoothing: antialiased; }
.tu-shu-app { min-height: 100vh; display: flex; flex-direction: column; }
.tu-shu-nav { border-bottom: 1px solid hsl(var(--tu-border)); background: hsl(var(--tu-surface)); position: sticky; top: 0; z-index: 10; backdrop-filter: blur(8px); }
.tu-shu-nav-inner { max-width: 1200px; margin: 0 auto; padding: 0.875rem 1.5rem; display: flex; align-items: center; gap: 2rem; }
.tu-shu-brand { font-weight: 600; font-size: 1.05rem; color: hsl(var(--tu-fg)); text-decoration: none; }
.tu-shu-nav-links { display: flex; gap: 1.5rem; font-size: 0.875rem; }
.tu-shu-nav-links a { color: hsl(var(--tu-fg-muted)); text-decoration: none; transition: color .15s; }
.tu-shu-nav-links a:hover { color: hsl(var(--tu-fg)); }

.tu-shu-doc { flex: 1; display: grid; grid-template-columns: 240px 1fr; max-width: 1200px; margin: 0 auto; width: 100%; }

/* Hamburger button — visible only on mobile. */
.tu-shu-hamburger { display: none; flex-direction: column; gap: 0.25rem; padding: 0.5rem; background: transparent; border: 1px solid hsl(var(--tu-border)); border-radius: var(--tu-radius-sm); cursor: pointer; margin-left: auto; }
.tu-shu-hamburger span { display: block; width: 1.125rem; height: 2px; background: hsl(var(--tu-fg)); border-radius: 1px; transition: transform .2s; }
.tu-shu-sidebar { padding: 2rem 1rem; border-right: 1px solid hsl(var(--tu-border)); }
.tu-shu-sidebar-group { margin-bottom: 1.5rem; }
.tu-shu-sidebar-group h3 { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; color: hsl(var(--tu-fg-muted)); margin: 0 0 0.5rem 0.5rem; font-weight: 600; }
.tu-shu-sidebar-group ul { list-style: none; padding: 0; margin: 0; }
.tu-shu-sidebar-group li { margin: 0; }
.tu-shu-sidebar-group a { display: block; padding: 0.375rem 0.625rem; border-radius: var(--tu-radius-sm); color: hsl(var(--tu-fg-muted)); text-decoration: none; font-size: 0.875rem; transition: background .15s, color .15s; }
.tu-shu-sidebar-group a:hover { background: hsl(var(--tu-surface-elevated)); color: hsl(var(--tu-fg)); }
.tu-shu-sidebar-group a.is-active { background: hsl(var(--tu-brand) / 0.15); color: hsl(var(--tu-brand)); }

.tu-shu-content { padding: 2rem 2.5rem; max-width: 800px; margin: 0 auto; width: 100%; min-width: 0; }
.tu-shu-prose { line-height: 1.65; }
.tu-shu-prose h1 { font-size: 2.25rem; font-weight: 700; margin: 0 0 1rem; letter-spacing: -0.02em; }
.tu-shu-prose h2 { font-size: 1.5rem; font-weight: 600; margin: 2.5rem 0 1rem; padding-bottom: 0.5rem; border-bottom: 1px solid hsl(var(--tu-border)); letter-spacing: -0.015em; }
.tu-shu-prose h3 { font-size: 1.2rem; font-weight: 600; margin: 1.75rem 0 0.75rem; }
.tu-shu-prose p { margin: 1rem 0; color: hsl(var(--tu-fg) / 0.92); }
.tu-shu-prose ul, .tu-shu-prose ol { padding-left: 1.5rem; margin: 1rem 0; }
.tu-shu-prose li { margin: 0.4rem 0; }
.tu-shu-prose a { color: hsl(var(--tu-brand)); text-decoration: none; }
.tu-shu-prose a:hover { text-decoration: underline; }
.tu-shu-prose code { background: hsl(var(--tu-surface-elevated)); padding: 0.15em 0.35em; border-radius: var(--tu-radius-sm); font-family: ui-monospace, 'JetBrains Mono', Menlo, Consolas, monospace; font-size: 0.875em; }
.tu-shu-prose pre { background: hsl(222 47% 5%); border: 1px solid hsl(var(--tu-border)); padding: 1rem 1.25rem; border-radius: var(--tu-radius); overflow-x: auto; margin: 1.25rem 0; line-height: 1.5; }
.tu-shu-prose pre code { background: transparent; padding: 0; font-size: 0.875rem; color: inherit; }
.tu-shu-prose blockquote { border-left: 3px solid hsl(var(--tu-brand)); padding-left: 1rem; margin: 1.25rem 0; color: hsl(var(--tu-fg-muted)); }
.tu-shu-prose hr { border: none; border-top: 1px solid hsl(var(--tu-border)); margin: 2rem 0; }
.tu-shu-prose table { border-collapse: collapse; margin: 1.25rem 0; width: 100%; font-size: 0.9rem; }
.tu-shu-prose th, .tu-shu-prose td { border: 1px solid hsl(var(--tu-border)); padding: 0.5rem 0.75rem; text-align: left; }
.tu-shu-prose th { background: hsl(var(--tu-surface)); font-weight: 600; }
.tu-shu-prose img { max-width: 100%; border-radius: var(--tu-radius); }

.tu-shu-home { max-width: 1100px; margin: 0 auto; padding: 4rem 1.5rem 6rem; }
.tu-shu-hero { text-align: center; padding: 3rem 0 4rem; }
.tu-shu-hero-title { font-size: clamp(2.5rem, 6vw, 4.5rem); font-weight: 700; letter-spacing: -0.03em; margin: 0 0 1.5rem; line-height: 1.05; }
.tu-shu-hero-name { display: block; background: linear-gradient(135deg, hsl(var(--tu-brand)) 0%, hsl(280 84% 70%) 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
.tu-shu-hero-text { display: block; color: hsl(var(--tu-fg-muted)); font-size: 0.5em; font-weight: 500; margin-top: 0.5rem; }
.tu-shu-hero-tagline { font-size: 1.125rem; color: hsl(var(--tu-fg-muted)); margin: 0 auto 2rem; max-width: 38rem; line-height: 1.5; }
.tu-shu-hero-actions { display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap; }
.tu-shu-action { display: inline-flex; align-items: center; padding: 0.625rem 1.25rem; border-radius: var(--tu-radius); font-size: 0.95rem; font-weight: 500; text-decoration: none; transition: background .15s, opacity .15s; border: 1px solid transparent; }
.tu-shu-action-brand { background: hsl(var(--tu-brand)); color: hsl(var(--tu-brand-fg)); }
.tu-shu-action-brand:hover { background: hsl(var(--tu-brand-hover)); }
.tu-shu-action-alt { background: hsl(var(--tu-surface-elevated)); color: hsl(var(--tu-fg)); border-color: hsl(var(--tu-border)); }
.tu-shu-action-alt:hover { background: hsl(var(--tu-border)); }
.tu-shu-features { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; margin: 3rem 0; }
.tu-shu-feature { padding: 1.5rem; background: hsl(var(--tu-surface)); border: 1px solid hsl(var(--tu-border)); border-radius: var(--tu-radius-lg); transition: border-color .15s; }
.tu-shu-feature:hover { border-color: hsl(var(--tu-brand) / 0.5); }
.tu-shu-feature h3 { margin: 0 0 0.5rem; font-size: 1.05rem; font-weight: 600; }
.tu-shu-feature-body { color: hsl(var(--tu-fg-muted)); font-size: 0.9rem; line-height: 1.55; }
.tu-shu-feature-body code { background: hsl(var(--tu-bg)); padding: 0.1em 0.3em; border-radius: var(--tu-radius-sm); font-family: ui-monospace, monospace; font-size: 0.85em; color: hsl(var(--tu-brand)); }
.tu-shu-feature-body a { color: hsl(var(--tu-brand)); text-decoration: none; }
.tu-shu-feature-body a:hover { text-decoration: underline; }

/* ─── Mobile breakpoint (≤ 768px) ─────────────────────────────────── */
@media (max-width: 768px) {
  body { font-size: 15px; }
  /* Nav: tighter padding, hide inline links, show hamburger. */
  .tu-shu-nav-inner { padding: 0.75rem 1rem; gap: 0.75rem; }
  .tu-shu-nav-links { display: none; }
  .tu-shu-hamburger { display: flex; }

  /* Doc layout: sidebar becomes a slide-in drawer triggered by
     [data-menu="open"] on <body>. Default state is hidden off-screen. */
  .tu-shu-doc { grid-template-columns: 1fr; position: relative; }
  .tu-shu-sidebar {
    position: fixed;
    top: 56px;
    left: 0;
    bottom: 0;
    width: min(280px, 80vw);
    z-index: 20;
    background: hsl(var(--tu-surface));
    overflow-y: auto;
    transform: translateX(-100%);
    transition: transform .2s;
    box-shadow: 0 0 24px rgba(0, 0, 0, 0.4);
  }
  body[data-menu="open"] .tu-shu-sidebar { transform: translateX(0); }
  body[data-menu="open"]::before {
    content: "";
    position: fixed;
    inset: 56px 0 0 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 19;
  }

  /* Content: tighter side padding, smaller headings. */
  .tu-shu-content { padding: 1.25rem 1rem 3rem; }
  .tu-shu-prose h1 { font-size: 1.75rem; }
  .tu-shu-prose h2 { font-size: 1.25rem; margin-top: 2rem; }
  .tu-shu-prose h3 { font-size: 1.05rem; }
  .tu-shu-prose pre { padding: 0.75rem; font-size: 0.8rem; border-radius: var(--tu-radius-sm); }
  .tu-shu-prose table { font-size: 0.85rem; }

  /* Hero: more compact for one-screen view. */
  .tu-shu-home { padding: 2rem 1rem 4rem; }
  .tu-shu-hero { padding: 1.5rem 0 2.5rem; }
  .tu-shu-hero-title { font-size: clamp(2rem, 9vw, 3rem); }
  .tu-shu-hero-tagline { font-size: 1rem; }
  .tu-shu-hero-actions { flex-direction: column; align-items: stretch; }
  .tu-shu-action { justify-content: center; }
  .tu-shu-features { grid-template-columns: 1fr; gap: 0.75rem; margin: 2rem 0; }
  .tu-shu-feature { padding: 1.25rem; }
}

/* Tablet breakpoint — keep sidebar but tighten gutters. */
@media (min-width: 769px) and (max-width: 1024px) {
  .tu-shu-doc { grid-template-columns: 200px 1fr; }
  .tu-shu-content { padding: 2rem 1.5rem; }
}
</style>`
