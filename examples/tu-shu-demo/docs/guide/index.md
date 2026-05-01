---
title: Why tu-shu
---

# Why tu-shu

Three reasons to use tu-shu over alternatives:

1. **It's Tu, all the way down.** No Vue, no React, no Vite plugin chain. The output is just HTML; the build is `markdown → vnode → renderPage`.

2. **Theme tokens come from `@tu-lang/tu-xing`.** Switching from light to dark, or rebranding, is one set of HSL CSS variable overrides. Same theme drives your docs site AND your app's UI components.

3. **The whole stack is small.** ~500 LOC for the SSG itself, vs ~10k for a typical full-featured docs framework. Easy to fork, easy to read, easy to extend.

## Architecture

```
docs/                  # source markdown
  index.md
  guide/
    intro.md
tu-shu.config.mjs     # TuShuConfig
```

Build pipeline (`tu-shu build`):

```
discoverPages   → walk docs/ for *.md
parseMarkdown   → markdown-it + gray-matter + Shiki
renderTheme     → wrap in default theme HTML
renderPageHtml  → @tu-lang/runtime full-page renderer
write to disk   → outDir/<url>.html
```
