/** @type {import('@tu-lang/tu-shu').TuShuConfig} */
export default {
  title: 'Tu (图)',
  description: 'A reactive UI language. Trailing-closure DSL, scoped styles, TC39 Signals, full LSP.',
  // The docs source lives in this directory; the build CLI runs from
  // here, so srcDir is just `.`. Hidden dirs (`.vitepress`) and
  // `node_modules` are auto-skipped; everything else excluded explicitly.
  srcDir: '.',
  srcExclude: [
    'README.md',           // GitHub-side README, not part of the deployed site
    'typecheck-demo/',     // legacy fixtures
    'tu-shu.config.mjs',   // never possible — config isn't .md — defensive
  ],
  outDir: '.tu-shu/dist',
  // CI sets TU_BASE='/tu/' for the Pages deploy. Local `pnpm --filter
  // tu-docs build:tu-shu` keeps the default `/`.
  base: process.env.TU_BASE ?? '/',
  lang: 'en',
  nav: [
    { text: 'Language', link: '/LANGUAGE' },
    { text: 'tu-xing', link: '/tu-xing' },
    { text: 'tu-shu', link: '/tu-shu' },
    { text: 'Tailwind', link: '/tailwind' },
    { text: 'Install', link: '/install' },
    { text: 'Skill (AI)', link: '/skill' },
    { text: 'Playground', link: '/playground/' },
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
      text: 'Ecosystem',
      items: [
        { text: 'tu-xing — UI library', link: '/tu-xing' },
        { text: 'tu-shu — SSG', link: '/tu-shu' },
        { text: 'Tailwind compat', link: '/tailwind' },
      ],
    },
    {
      text: 'Live',
      items: [
        { text: 'Playground', link: '/playground/' },
        { text: 'tu-shu preview', link: '/tu-shu-preview/' },
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
}
