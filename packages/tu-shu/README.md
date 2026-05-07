# tu-shu (图书)

Tu-native static site generator. Markdown in, themed HTML pages out — built on `@tu-lang/runtime` SSR primitives and `@tu-lang/router` file-path URL helpers.

## Status: pre-alpha (V1)

Ships:

- Markdown parsing via [markdown-it](https://github.com/markdown-it/markdown-it)
- Frontmatter via [gray-matter](https://github.com/jonschlinkert/gray-matter)
- Code-block highlighting via [Shiki](https://shiki.style/)
- File-based routing (`docs/foo.md` → `/foo`, `docs/bar/index.md` → `/bar/`)
- Default theme using `@tu-lang/tu-xing` design tokens
- `tu-shu build` CLI

## Install

```sh
pnpm add -D @tu-lang/tu-shu
```

## Use

Project layout:

```
my-site/
  docs/
    index.md
    guide/
      intro.md
  tu-shu.config.mjs
```

`tu-shu.config.mjs`:

```js
/** @type {import('@tu-lang/tu-shu').TuShuConfig} */
export default {
  title: 'My Tu Site',
  description: 'Built with tu-shu',
  srcDir: 'docs',
  outDir: '.tu-shu/dist',
  base: '/',
  nav: [
    { text: 'Home', link: '/' },
    { text: 'Guide', link: '/guide/intro' },
  ],
  sidebar: [
    { text: 'Get started', items: [{ text: 'Intro', link: '/guide/intro' }] },
  ],
}
```

Build:

```sh
npx tu-shu build
```

Output lands in `outDir` — deploy that directory to any static host (GitHub Pages, Netlify, Vercel, S3 + CloudFront).

## Config

```ts
interface TuShuConfig {
  title?: string
  description?: string
  srcDir?: string             // default: './docs'
  outDir?: string             // default: './.tu-shu/dist'
  base?: string               // default: '/'
  nav?: Array<{ text: string; link: string }>
  sidebar?: Array<{ text: string; items: Array<{ text: string; link: string }> }>
  lang?: string               // default: 'en'
}
```

## Frontmatter

YAML frontmatter is parsed and made available on the `Page` model. The `title` field overrides the auto-detected first H1.

```md
---
title: Custom page title
---

# This first heading is ignored if frontmatter.title is set
```

## What's NOT in V1

(Tracked in `docs/DEFERRED.md`.)

- Dev server with HMR — use a watch loop wrapping `tu-shu build` for now.
- Per-page client-side hydration (Tu thunks mounted into pages) — V1 ships pure-static HTML.
- Search.
- Multi-locale.
- Theme customization beyond the CSS-variable token override.
- Plugins.

## Roadmap

- `tu-shu dev` with HMR (next milestone)
- Per-page client islands via Tu thunk imports
- Configurable theme components (let consumers swap default theme)
- Search index (lunr-style)

## License

MIT
