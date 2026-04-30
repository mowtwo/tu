# Tu Documentation

Documentation source for the Tu site (built with [VitePress](https://vitepress.dev)).

- [Language reference](./LANGUAGE.md) — every Tu syntactic form that compiles today, with examples and emit shapes
- [Deferred backlog](./DEFERRED.md) — running list of "leave for later" items with introducing/target milestones
- Project overview: [GitHub README](https://github.com/mowtwo/tu#readme)

To work on the site locally:

```sh
pnpm install
pnpm --filter tu-docs dev    # serves http://localhost:5173/
pnpm --filter tu-docs build  # static output at docs/.vitepress/dist/
```
