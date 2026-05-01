---
title: Welcome
---

# Welcome to tu-shu

A **Tu-native static site generator** built on `@tu-lang/runtime` + `renderPage`. Source files are markdown; output is a directory of static HTML pages.

## Why

VitePress is great, but it's Vue-only. tu-shu is the same shape — markdown in, themed pages out — but built end-to-end on Tu's own primitives. That means:

- The same `renderPage` API you'd use to ship any other Tu app.
- The same theme tokens that drive the `@tu-lang/tu-xing` UI library.
- No special framework to learn — it's just Tu.

## Quick start

```bash
pnpm add -D @tu-lang/tu-shu
```

Create `docs/index.md` and a `tu-shu.config.mjs`:

```js
export default {
  title: 'My Tu Site',
  description: 'Documentation built with tu-shu',
}
```

Then `npx tu-shu build`.

## Status

Pre-alpha. V1 ships:

- Markdown → HTML via markdown-it
- File-based routing (`docs/foo.md` → `/foo`)
- Code blocks via Shiki (default `github-dark`)
- Frontmatter via gray-matter
- Default theme using `@tu-lang/tu-xing` tokens
- Static build (no dev server yet — use Vite + a simple watch loop for now)
