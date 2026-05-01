---
title: Markdown features
---

# Markdown features

tu-shu uses **markdown-it** for parsing — standard CommonMark plus a few enabled extensions.

## Code blocks with Shiki

Inline `code` and triple-backtick blocks both work:

```ts
import { renderPage } from '@tu-lang/runtime'

renderPage(() => h('div', {}, ['hello']))
```

Tu-flavoured highlighting (when the `tu` grammar is registered):

```tu
type Point = { x: number; y: number }
export let origin: Point = { x: 0, y: 0 }
```

## Lists, links, and emphasis

- Bullet item with **bold** and _italic_
- Link to [the repo](https://github.com/mowtwo/tu)
- Inline `code`

1. Ordered
2. List
3. Items

## Quotes and horizontal rules

> A quote block.

---

Three dashes for an `<hr>`.

## Tables

| Column 1 | Column 2 |
|---|---|
| left | right |
| more | data |
