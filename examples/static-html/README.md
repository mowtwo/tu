# static-html — M6.0 verification

The compiler folds reactive-free markup subtrees into a single
`h("$static", {}, [], "<div>…</div>")` call so the runtime can adopt the
HTML once via `<template>.innerHTML` instead of calling `h()` per nested
node. Detection lives in `packages/compiler/src/codegen.ts` (`isStaticTree`
+ `countStaticNodes >= 3`); the runtime branch is in
`packages/runtime/src/index.ts` (look for `STATIC_TAG`).

This example is a *verification harness*, not a UI demo: `Welcome.tu`
is a fully-static `<div>` tree, and `verify.mjs` checks that:

1. The compiler emits `h("$static", …)` for the body.
2. SSR passes the html through unchanged.

Run:

```sh
pnpm --filter @tu-examples/static-html test
```

Output should print "✓ static-HTML optimization confirmed (M6.0)."

If you tweak `Welcome.tu` to read a Signal cell anywhere in the subtree,
the optimization disengages — you'll see `h("div", …)` calls reappear
because `isStaticTree` correctly excludes any subtree with reactive deps.
