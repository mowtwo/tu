// Generated from docs/tu-shu.md — Tu-native docs page.

export let frontmatter = {}

export let Page = () => div {
  markdown {
    # tu-shu (图书)

    A Tu-native static site generator. Markdown in, themed HTML pages out — all built on `@tu-lang/runtime`'s `renderPage` primitive.

    > Published as [`@tu-lang/tu-shu`](https://www.npmjs.com/package/@tu-lang/tu-shu) on npm.

    ## V1 ships

    - Markdown parsing via [markdown-it](https://github.com/markdown-it/markdown-it) (CommonMark + GFM extensions)
    - Frontmatter via [gray-matter](https://github.com/jonschlinkert/gray-matter)
    - Code-block highlighting via [Shiki](https://shiki.style/) (default `github-dark`)
    - File-based routing — `docs/foo.md` → `/foo`, `docs/bar/index.md` → `/bar/`
    - Default theme using `@tu-lang/tu-xing` design tokens
    - `tu-shu build` CLI

    ## Why a Tu-native SSG?

    VitePress is great, but it's Vue-only. tu-shu is the same shape — markdown in, themed pages out — but built end-to-end on Tu's own primitives:

    - The same `renderPage` API you'd use to ship any Tu app.
    - The same theme tokens that drive the `@tu-lang/tu-xing` UI library.
    - No special framework to learn — it's just Tu.
    - ~500 LOC for the SSG itself, vs ~10 k for a typical full-featured docs framework. Easy to fork, easy to read, easy to extend.

    ## Install

    ```sh
    pnpm add -D @tu-lang/tu-shu
    ```

    ## Project layout

    ```
    my-site/
      docs/
        index.md
        guide/
          intro.md
      tu-shu.config.mjs
    ```

    ## Config

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

    ## Build

    ```sh
    npx tu-shu build
    ```

    Output lands in `outDir` — deploy that directory to any static host (GitHub Pages, Netlify, Vercel, S3 + CloudFront).

    ## Architecture

    ```
    discoverPages   → walk docs/ for *.md
    parseMarkdown   → markdown-it + gray-matter + Shiki
    renderTheme     → wrap in default theme HTML
    renderPageHtml  → @tu-lang/runtime full-page renderer
    write to disk   → outDir/<url>.html
    ```

    ## Roadmap

    - `tu-shu dev` with HMR
    - Per-page client-side hydration islands (Tu thunks mounted into pages)
    - Configurable theme components (let consumers swap the default theme)
    - Search index
    - Multi-locale
    - Plugin system

    ## Status

    Pre-alpha. The build pipeline works end-to-end (every `.md` you put in `srcDir` becomes a static HTML page), but missing dev-server HMR and per-page hydration. For day-to-day docs work today, VitePress remains a more polished option — tu-shu shines when you want full control of the pipeline OR when you're already building a Tu app and want the same theme tokens to drive the docs.

  }
}
