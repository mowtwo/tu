# suspense — M6.11 demo

Tu's M6.11 SSR async ladder ships three pieces:

- `renderToStringAsync` — awaits any Promise child + emits one HTML string.
- `Suspense({ fallback, children })` — boundary primitive; catches Promise
  rejections and renders the fallback Child instead.
- `renderToStream` — Web ReadableStream that flushes the shell + per-boundary
  fallbacks first, then resolved bodies as `<template>` chunks in resolution
  order.

`Page.tu` declares two async `UserCard`s wrapped in `Suspense`. `run.mjs`
exercises both pipelines and prints the output:

```sh
pnpm --filter @tu-examples/suspense test
```

Look for the streaming output: the first chunk is the page shell + the two
`<div data-tu-suspense="N">…spinner…</div>` placeholders + the
`$tu_replace` polyfill. Then each boundary flushes a `<template id="S:N">`
+ a one-line `<script>$tu_replace("N")</script>` chunk as soon as its
`UserCard` resolves. Resolution order, not source order — the fast card
arrives first even though it appears second.

`renderToStringAsync` produces the same final HTML as the streaming case
but waits for both cards before emitting anything.
