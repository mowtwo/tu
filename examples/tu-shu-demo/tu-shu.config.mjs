/** @type {import('@tu-lang/tu-shu').TuShuConfig} */
export default {
  title: 'tu-shu demo',
  description: 'Tu-native static site generator demo.',
  srcDir: 'docs',
  outDir: '.tu-shu/dist',
  base: '/',
  nav: [
    { text: 'Home', link: '/' },
    { text: 'Guide', link: '/guide/' },
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
}
