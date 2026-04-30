import { defineConfig } from 'vitepress'
import tuGrammar from '../../packages/vscode/syntaxes/tu.tmLanguage.json' with { type: 'json' }

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
  ignoreDeadLinks: [
    'localhostLinks',
    // Generated at deploy time by .github/workflows/deploy-docs.yml; not
    // present in local dev builds. The CI step `Stage install artifacts`
    // drops the vsix into docs/public/install/ before vitepress runs.
    /\/vscode-tu-latest\.vsix$/,
  ],
  markdown: {
    // Register Tu's TextMate grammar so ```tu code blocks highlight on the
    // site. The grammar source is the same `.tmLanguage.json` that drives
    // the `vscode-tu` extension — single source of truth for syntax
    // colorization across editor and docs.
    languages: [
      {
        ...(tuGrammar as object),
        name: 'tu',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ],
  },
  themeConfig: {
    nav: [
      { text: 'Language', link: '/LANGUAGE' },
      { text: 'Skill (for AI)', link: '/skill' },
      { text: 'Install', link: '/install' },
      { text: 'Deferred', link: '/DEFERRED' },
      { text: 'GitHub', link: 'https://github.com/mowtwo/tu' },
    ],
    sidebar: [
      {
        text: 'Get started',
        items: [
          { text: 'Introduction', link: '/' },
          { text: 'Install', link: '/install' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Language', link: '/LANGUAGE' },
          { text: 'Deferred backlog', link: '/DEFERRED' },
        ],
      },
      {
        text: 'For AI agents',
        items: [
          { text: 'Skill (LLM-targeted)', link: '/skill' },
          { text: 'llms.txt (raw)', link: '/llms.txt' },
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
