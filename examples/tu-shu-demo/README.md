# tu-shu-demo

Showcases `@tu-lang/tu-shu` — markdown → static HTML via Tu's `renderPage`.

## Run

```sh
pnpm install
pnpm build
```

The site renders into `.tu-shu/dist/`. Open `index.html` in a browser, or serve the directory:

```sh
npx serve .tu-shu/dist
```

## What's in `docs/`

- `index.md` — landing page with frontmatter + headings + code blocks.
- `guide/index.md` — nested page; URL is `/guide/`.
- `guide/markdown.md` — exercises markdown features (lists, links, tables, quotes).

The build pipeline is the same one tu-shu's own README walks through:
discover pages → parse markdown → render theme → write HTML.
