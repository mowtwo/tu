/** @type {import('@tu-lang/tu-shu').TuShuConfig} */
export default {
  title: 'tu-shu demo',
  description: 'Tu-native static site generator demo.',
  srcDir: 'docs',
  outDir: '.tu-shu/dist',
  // CI sets TU_BASE=/tu/tu-shu-preview/ when staging under the docs site
  // at https://mowtwo.github.io/tu/tu-shu-preview/. Local `pnpm demo`
  // keeps the default `/`.
  base: process.env.TU_BASE ?? '/',
  favicon: 'https://mowtwo.github.io/tu/favicon.svg',
  nav: [
    { text: 'Home', link: '/' },
    { text: 'Guide', link: '/guide/' },
    { text: '↑ Tu docs', link: 'https://mowtwo.github.io/tu/' },
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
      text: 'Guide',
      items: [
        { text: 'Why tu-shu', link: '/guide/' },
        { text: 'Markdown features', link: '/guide/markdown' },
      ],
    },
  ],
  // Bundle Tailwind via CDN + tu-xing theme tokens so the static output
  // is fully styled without a build step.
  stylesheets: [
    'https://cdn.jsdelivr.net/npm/@tu-lang/tu-xing@alpha/src/theme.css',
    'https://cdn.tailwindcss.com',
  ],
}
