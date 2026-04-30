# Example: Scoped (M1.8 — symbolic class refs + scoping)

Two components, `RedCard` and `BlueCard`, both declare a `.card` style. Pre-M1.8 the second `.card { … }` rule would override the first since they share the global stylesheet. With M1.8's scoping, each component's `.card` becomes `.card-tu-{differentHash}` and the two cards keep their own visual treatment.

Visual-only demo — exercise it via the playground:

```bash
pnpm --filter tu-playground dev
```

…and pick **M1.8 Scoped** from the sidebar.
