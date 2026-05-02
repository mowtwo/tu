# Async SSR + Suspense — design

Status: design / pre-implementation
Owner: M6.3+ ladder (closes the `Async / Suspense / streaming SSR` row in `docs/DEFERRED.tu`)
Tasks: #59 (this doc) → #60 (async render) → #61 (Suspense) → #62 (streaming)

## 1. Why now

The language already has `async / await / dynamic import()` (landed M6.6). The SSR runtime does not — `renderToString`, `renderPage`, `renderPageHtml` walk the vnode tree synchronously and have no concept of "this child is a promise". A Tu component written as

```tu
let UserCard = async (id: string) => async {
  let user = await fetchUser(id)
  div { user.name }
}
```

compiles cleanly today (M6.6), but invoking `UserCard("alice")` returns `Promise<VNode>`. `renderToString` would coerce that promise to `[object Promise]` via `String(node)` and emit literal garbage.

Closing the gap unlocks tu-shu pages that load data at build time, a real-world SSR story for Tu apps, and a clear path to streaming. `tu-shu/build.ts` is already an `async` function — its IO + `import()` of compiled `.mjs` are async — but the actual render call (`renderToString(Page())`) is sync, so a `Page` that wants to `await` something has nowhere to land that promise.

## 2. Non-goals (this ladder)

- **Resumability** — Qwik-style "client never re-runs the first-frame thunk after hydration" is its own deferred row. Tu's hydrate adopts DOM but still re-executes the thunk. This design keeps that contract.
- **Per-cell-read fine-grained reactivity** — orthogonal; stays on its own row.
- **Compiler changes** — this design is a runtime-only change. M6.6's async lambdas already compile `async () => …` to TS `async () => Promise<…>` and `await x` to `await x`. The renderer only needs to learn to await Promise children.
- **DOM-side `mount(asyncThunk)`** — interesting but separable; CSR async loading is closer to Suspense-on-mount and goes in a follow-up row, not this ladder.

## 3. Architecture in one paragraph

`Child` grows one new variant: `Promise<Child>`. The sync renderer rejects it (typed error, not silent garbage). A new `renderToStringAsync` walks the same shape but `await`s any promise it meets. A `Suspense` primitive — implemented as a sentinel vnode `tag: '$suspense'` carrying `{ fallback, children }` — gives the async renderer a place to fall back to when its subtree has unresolved work, and gives the streaming renderer a flushable boundary. Streaming layers on top: same render walk, but yields ready segments early and emits resolved boundaries later as `<template>` + replacement script (the React-18 / Marko pattern).

## 4. Data model

### 4.1 Child becomes promise-aware

```ts
// @tu-lang/runtime
export type Child =
  | VNode
  | string
  | number
  | null
  | undefined
  | Child[]
  | Promise<Child>          // NEW
```

Sync `renderToString` (unchanged signature, unchanged perf):

```ts
export function renderToString(node: Child): string {
  // … existing branches …
  if (isPromise(node)) {
    throw new TuRenderError(
      'renderToString hit a Promise child. Use renderToStringAsync, ' +
      'or wrap the boundary in <Suspense>.'
    )
  }
  // …
}
```

The throw is intentional: we never want a sync caller to silently emit `<div>[object Promise]</div>`. Sync callers (the playground's compile-and-mount, every existing test) keep their sync contract; if they hit a promise it's a bug surfaced at the right moment.

### 4.2 `$suspense` sentinel

Same shape pattern as `$static` (M6.0): the runtime understands a magic tag:

```ts
// runtime helper, exported as `Suspense`
export function Suspense(opts: { fallback: Child }, children: Child[]): VNode {
  return { tag: '$suspense', props: { fallback: opts.fallback }, children }
}
```

Tu call-site (M6.1 named-arg form):

```tu
import { Suspense } from "@tu-lang/runtime"

Suspense(fallback: div { "Loading…" }) {
  UserCard("alice")
}
```

The body of `Suspense { … }` is the `children` arg by Tu's component-block convention; `fallback:` is a named prop, evaluated eagerly to a `Child` (promise here is allowed and would itself resolve before fallback is needed — matches React semantics).

## 5. `renderToStringAsync`

```ts
export async function renderToStringAsync(node: Child): Promise<string> {
  if (node == null) return ''
  if (typeof node === 'string') return escapeText(node)
  if (typeof node === 'number') return String(node)
  if (isPromise(node)) return renderToStringAsync(await node)
  if (Array.isArray(node)) {
    // Resolve children in parallel — independent subtrees should not serialize.
    const parts = await Promise.all(node.map(renderToStringAsync))
    return parts.join('')
  }
  return renderVNodeAsync(node)
}
```

`renderVNodeAsync` mirrors `renderVNode` but `await`s child rendering. The static-HTML fast path (`tag === '$static'`) stays sync — those subtrees are by-construction promise-free.

The Suspense branch in `renderVNodeAsync`:

```ts
if (node.tag === '$suspense') {
  const fallback = node.props.fallback as Child
  try {
    return await renderToStringAsync(node.children)
  } catch (err) {
    // v1: any throw inside the boundary → emit fallback. (#61 widens this:
    // distinguish "render error" from "intentional pending throw" so the
    // streaming variant can flush the resolved body later.)
    return await renderToStringAsync(fallback)
  }
}
```

Parallelism: a single Suspense's body subtree resolves in parallel via the `Array.isArray` branch's `Promise.all`. Two siblings each containing their own Suspense run in parallel too. The only serialization is across textually-nested awaits — same as raw JS.

## 6. `renderPageAsync` / tu-shu wiring

```ts
export async function renderPageAsync(
  thunk: () => Child | Promise<Child>,
  options: RenderPageOptions = {}
): Promise<string> {
  const body = await renderToStringAsync(await thunk())
  return assemblePage(body, options)
}
```

Note `thunk` itself may be async — Tu's `let Page = async () => …` compiles to an async lambda, so calling it returns a promise.

`tu-shu/build.ts` change: replace `renderToString(Page())` with `await renderToStringAsync(Page())` and switch to `renderPageHtmlAsync` if we add one (probably not — `assemblePage` is already pure-string and only the body needs awaiting).

`tu-shu/tu-page.ts` already lives inside an async function. The current code calls `Page()` and passes the result through sync `renderToString`. After #60 it becomes:

```ts
const vnode = Page()
const html = await renderToStringAsync(vnode as never)
```

— one keyword. Pages that don't await still walk through the async path with no extra microtask cost beyond the outer `await` (the inner walk hits no promises and returns its string immediately).

## 7. Streaming (#62 outline)

```ts
export function renderToStream(
  thunk: () => Child | Promise<Child>,
  options: RenderPageOptions & { onShellReady?: () => void } = {}
): ReadableStream<Uint8Array>
```

Strategy (mirrors React 18 / Marko):

1. Open the stream by emitting the assembled `<!doctype html><html>…<body>` shell + `<div id="tu-root">`.
2. Walk the tree synchronously up to each `$suspense` boundary. For each pending boundary:
   - Emit the fallback content wrapped in `<div data-tu-suspense="N">…</div>`.
   - Schedule the boundary's body resolution; on completion, push:
     ```html
     <template id="S:N">…resolved body…</template>
     <script>$tu_replace("N")</script>
     ```
3. When all boundaries resolve, close the body + html.

The replacement script `$tu_replace` is a tiny client polyfill (~15 lines) that runs in the user's HTML before hydration; it replaces the `data-tu-suspense="N"` div's contents with the template's children. Hydration (in `@tu-lang/dom`) is unaware — by the time `hydrate(thunk, root)` runs on `DOMContentLoaded` (or on a `streamReady` event we emit), the DOM looks like a full SSR result.

Out of scope for #62: backpressure tuning, abort-controller plumbing (cancel mid-stream), `<Suspense>` revealOrder modes — all on a follow-up row.

## 8. Hydration story

`hydrate(thunk, container)` re-executes `thunk` on the client. If `thunk` is an async component, the first frame is the SSR DOM (already adopted), and the second frame happens after the client thunk's promise resolves. Two cases:

**Case A: client data matches server data.** The async resolution produces the same vnode tree the server emitted. `patchChildren` is a no-op on identity. Net effect: SSR DOM intact, listeners attached, no flash.

**Case B: client data diverges (e.g. user-personalized vs static).** Standard hydration mismatch path applies — runtime logs `[@tu-lang/runtime] hydration mismatch: …` and patches to the new tree. Same as today.

For non-streaming async SSR (#60+#61 only, no #62), the client never sees a fallback — server already awaited everything. So hydration is unchanged from today.

For streaming SSR (#62), the client *might* see a fallback if it executes scripts before the boundary's `<template>` arrives. Mitigation: the auto-injected `$tu_replace` runs on each template's parse, so by the time the user's `hydrate()` call fires (at end-of-body or `DOMContentLoaded`), all reachable templates have replaced their fallbacks. Boundaries that take longer than `DOMContentLoaded` keep their fallback in the SSR DOM and get adopted as-is by hydrate — fine, the next async resolution will swap them.

## 9. Error handling

Two failure modes inside an async render:

1. **Promise rejection inside a Suspense boundary** — caught, fallback emitted (v1). Future: an `onError` prop. Nothing escapes the boundary; the rest of the page renders.
2. **Promise rejection outside any Suspense boundary** — propagates out of `renderToStringAsync`. `tu-shu/build.ts` will see it as a thrown error, log the page path, and exit non-zero. We do NOT auto-wrap the page root in a Suspense; that's the user's call.

Synchronous throws (existing behavior) are unchanged.

## 10. Backwards compatibility

- `renderToString`: signature unchanged. New behavior: hitting a `Promise` child throws (was: silently `String(promise)`-stringified to `[object Promise]`). This is a strict improvement and the only way to discover an accidentally-async component in a sync caller.
- `renderPage` / `renderPageHtml`: unchanged. Sync callers keep working.
- `Child` type: gains `Promise<Child>`. Existing TS consumers who narrowed on the sync variants need to add a `isPromise` guard if they want to handle the new case; otherwise `tsc` will widen their unions and the existing unreachable branches stay unreachable.
- `@tu-lang/dom` `mount` / `hydrate`: NO change in #60-#61. Streaming hydration glue (#62) adds the `$tu_replace` inline script; nothing breaks for non-streaming users.

## 11. Test plan

Per phase:

**#60** — renderToStringAsync
- Promise resolving to a vnode — renders inner.
- Nested promise (Promise → vnode containing Promise) — both await.
- Array of promises — `Promise.all`-style parallelism (verify with timed promises).
- Reject — propagates.
- Sync `renderToString` on a Promise child — throws `TuRenderError`.
- tu-shu loadTuPage — async Page export round-trips end-to-end.

**#61** — Suspense
- Suspense wrapping a resolving promise — renders body, never fallback.
- Suspense wrapping a rejecting promise — renders fallback, body suppressed.
- Nested Suspense — outer fallback never fires when inner already covers.
- Sibling Suspense boundaries resolve independently.

**#62** — streaming
- Single boundary, stream emits shell → fallback → template + replace.
- Two parallel boundaries — interleaved templates in resolution order.
- Stream consumed via `for await (const chunk of stream)` round-trips identical bytes to `renderPageAsync` once all boundaries resolve.
- jsdom integration test: parse stream, run scripts, assert final DOM equals `renderPageAsync` output.

## 12. DEFERRED.tu impact

After #60+#61 land, the open row at `docs/DEFERRED.tu` line 30 narrows from

> Async / Suspense / streaming SSR — M6.2 ships sync `renderPage` only. Tu has no `async`/`await` syntax. Streaming, per-route data prefetch, and Qwik-style resumability are future work.

to

> Streaming SSR + resumability — `renderToStringAsync` and `Suspense` ship in M6.11. Streaming flush + Qwik resumability are future work.

After #62, the row narrows again to just resumability (or splits into two rows). Each phase removes the closed sub-bullet in the same commit, per the project rule.

## 13. Open questions (revisit during implementation)

- Should `Suspense.fallback` itself be allowed to throw / contain promises? React: yes, fallbacks can render — but our v1 emits fallback via `renderToStringAsync(fallback)` which already handles both cases. Free.
- Do we need a `renderPageAsync` AT ALL or just `await renderToStringAsync(thunk())` + existing `renderPageHtml`? Yes — keeping symmetry with the sync API ladder. Implementing it as a 3-line wrapper is cheap.
- Should the static-HTML optimization (`$static` tag) participate in async — i.e. could a `$static` body be a promise? No: `$static` is by definition compile-time-resolved markup. The compiler's `isStaticTree` predicate already excludes any subtree containing component invocations, so it can't accidentally include an async component.
- Compile-time error if a Tu component is `async` but the call-site is in a sync renderer? Not for v1 — runtime throw is sufficient and the error message can recommend `renderToStringAsync`. Compile-time check would need cross-module flow analysis (M3-territory) and isn't worth blocking on.
