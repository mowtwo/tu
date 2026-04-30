import { defineConfig } from 'vitepress'

// VitePress site for Tu (图). Source markdown lives in docs/ alongside this
// config; the static build lands in docs/.vitepress/dist/, which the GitHub
// Pages workflow uploads on every push to main.
//
// `base` is set to '/tu/' because the repo is published at
// https://mowtwo.github.io/tu/ — adjust if the repo is renamed or moved to a
// custom domain.
export default defineConfig({
  title: 'Tu (图)',
  description: 'A reactive UI language. Trailing-closure DSL, scoped styles, TC39 Signals, full LSP.',
  base: '/tu/',
  cleanUrls: true,
  lastUpdated: true,
  // Skip the legacy typecheck-demo dir — it's snapshot fixtures, not pages.
  srcExclude: ['typecheck-demo/**'],
  ignoreDeadLinks: 'localhostLinks',
  themeConfig: {
    nav: [
      { text: 'Language', link: '/LANGUAGE' },
      { text: 'Deferred', link: '/DEFERRED' },
      { text: 'GitHub', link: 'https://github.com/mowtwo/tu' },
    ],
    sidebar: [
      {
        text: 'Get started',
        items: [
          { text: 'Introduction', link: '/' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Language', link: '/LANGUAGE' },
          { text: 'Deferred backlog', link: '/DEFERRED' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/mowtwo/tu' }],
    outline: { level: [2, 3] },
    editLink: {
      pattern: 'https://github.com/mowtwo/tu/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
  },
})
