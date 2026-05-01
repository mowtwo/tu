// Default tu-shu theme — pure-string assembly to avoid runtime dependency
// on the Tu compiler at build time. Future themes can be authored as
// `.tu` files and pre-compiled into the consuming project's pipeline.
//
// The shape mirrors VitePress's default theme: top nav, optional
// sidebar, main content slot. Markup uses Tailwind utility classes and
// references the @tu-lang/tu-xing theme tokens — consumers should
// import `@tu-lang/tu-xing/theme.css` plus a Tailwind setup, exactly
// like the rest of the Tu ecosystem.

import type { NavItem, Page, SidebarSection, TuShuConfig } from '../types.js'

export function renderTheme(
  page: Page,
  config: TuShuConfig
): { head: string; body: string } {
  const base = config.base ?? '/'
  const nav = config.nav ?? []
  const sidebar = config.sidebar ?? []
  const head = headExtras()
  const body =
    `<div class="min-h-screen flex flex-col">` +
    renderNavBar(config.title ?? '', nav, base) +
    `<div class="flex-1 flex max-w-screen-xl mx-auto w-full">` +
    (sidebar.length > 0 ? renderSidebar(sidebar, base, page.url) : '') +
    `<main class="flex-1 px-6 py-8 prose prose-invert max-w-3xl mx-auto">` +
    page.html +
    `</main></div></div>`
  return { head, body }
}

function headExtras(): string {
  // Inline Tailwind reset + tu-xing theme via CDN-ish stub. In V1 the
  // consumer is expected to drop in their own bundled CSS via
  // tu-shu.config.ts (see Page-level link injection in build.ts).
  return ''
}

function renderNavBar(title: string, items: NavItem[], base: string): string {
  let html =
    `<header class="border-b border-[hsl(var(--tu-border))] bg-[hsl(var(--tu-surface))]">` +
    `<div class="max-w-screen-xl mx-auto px-6 py-3 flex items-center gap-6">` +
    `<a href="${escAttr(base)}" class="font-semibold text-[hsl(var(--tu-fg))]">${escText(title)}</a>` +
    `<nav class="flex gap-4 text-sm">`
  for (const it of items) {
    html += `<a href="${escAttr(joinUrl(base, it.link))}" class="text-[hsl(var(--tu-fg-muted))] hover:text-[hsl(var(--tu-fg))]">${escText(it.text)}</a>`
  }
  html += `</nav></div></header>`
  return html
}

function renderSidebar(sections: SidebarSection[], base: string, currentUrl: string): string {
  let html = `<aside class="w-60 shrink-0 border-r border-[hsl(var(--tu-border))] py-8 px-4 hidden md:block">`
  for (const sec of sections) {
    html += `<div class="mb-6">`
    html += `<h3 class="text-xs uppercase tracking-wider text-[hsl(var(--tu-fg-muted))] mb-2 px-2">${escText(sec.text)}</h3>`
    html += `<ul class="space-y-1">`
    for (const it of sec.items) {
      const active = it.link === currentUrl
      const cls = active
        ? 'block px-2 py-1 rounded bg-[hsl(var(--tu-brand))]/15 text-[hsl(var(--tu-brand))]'
        : 'block px-2 py-1 rounded text-[hsl(var(--tu-fg-muted))] hover:text-[hsl(var(--tu-fg))] hover:bg-[hsl(var(--tu-surface-elevated))]'
      html += `<li><a href="${escAttr(joinUrl(base, it.link))}" class="${cls}">${escText(it.text)}</a></li>`
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
