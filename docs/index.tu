// docs/index.tu — landing page, written in Tu (dogfood). The exported
// `frontmatter` object drives the home layout (hero + feature grid),
// the `Page` component renders the markdown body that follows.

export let frontmatter = {
  layout: "home",
  hero: {
    name: "Tu",
    text: "图",
    tagline: "A reactive UI language. Trailing-closure DSL, scoped styles, TC39 Signals, full LSP.",
    actions: [
      { theme: "brand", text: "Language reference", link: "/LANGUAGE" },
      { theme: "alt",   text: "Live playground",     link: "/playground/" },
      { theme: "alt",   text: "View on GitHub",      link: "https://github.com/mowtwo/tu" },
    ],
  },
  features: [
    { title: "Trailing-closure DSL", details: "<code>div(class: \"row\") { h1 { \"hi\" } p { x } }</code> — markup, props, and children read top-to-bottom in one syntax." },
    { title: "Reactive by default", details: "Top-level <code>let count = 0</code> auto-binds to a TC39 Signal cell. <code>computed(...)</code> cells re-derive on mutation. Reads inject <code>.get()</code> automatically." },
    { title: "Scoped styles", details: "<code>style { .card { ... } }</code> at the bottom of any component. Symbolic class refs (<code>.card()</code>) get a per-component hash so rules never bleed." },
    { title: "Types via TypeScript", details: "Volar pattern — Tu compiles to a TypeScript shadow, tsserver does the inference. Hover, completion, goto-definition, and rename all work cross-<code>.tu</code>." },
    { title: "Object literals + member access", details: "<code>let p: Point = { x: 1, y: 2 }</code> and <code>p.x</code> work end-to-end with reactive cells. Lambda return-type annotations close the typed-data loop." },
    { title: "Native markdown blocks", details: "<code>markdown { … }</code> as a first-class language form (M6.3) — embed prose alongside Tu components, pre-rendered at compile time." },
    { title: "SSR + Suspense + streaming (M6.11)", details: "<code>renderToString()</code> for sync server-side rendering, <code>renderPageAsync()</code> + <code>Suspense</code> for async data fetching, <code>renderToStream()</code> for ReadableStream-based per-boundary flushing, <code>hydrate()</code> for the client handoff (focus / scroll / <code>&lt;input&gt;</code> value preserved). See the <a href=\"https://github.com/mowtwo/tu/tree/main/examples/suspense\">suspense example</a>." },
    { title: "Ecosystem", details: "<a href=\"/tu-xing\">tu-xing</a> — shadcn-style UI library. <a href=\"/tu-shu\">tu-shu</a> — Tu-native SSG (renders this page). <a href=\"/tailwind\">Tailwind</a> drops in via <code>@source</code>. The whole stack dogfoods itself." },
  ],
}

// The body following the hero/features. `markdown { … }` is the M6.3
// native block — Tu source mixes prose + interactive Tu components on
// the same page. This page is itself proof: rendered by tu-shu, its
// theme uses tu-xing tokens, all running on the same Tu compiler that
// builds the rest of the ecosystem.
export let Page = () => div {
  markdown {
    ## Quick taste

    ```tu
    type Point = { x: number; y: number }

    export let origin: Point = { x: 0, y: 0 }

    export let App = () => .panel() {
      h1 { "Hello, Tu!" }
      p { "origin.x = " origin.x ", origin.y = " origin.y }

      button(onClick: () => origin = { x: origin.x + 1, y: origin.y + 1 }) {
        "bump"
      }

      style {
        .panel { padding: 1rem; font-family: system-ui, sans-serif; }
        .panel > h1 { color: #312e81; }
      }
    }
    ```

    - `type Point = …` — TS-style alias; threaded into the TS-mode emit verbatim.
    - `let origin: Point = { x: 0, y: 0 }` — top-level `let` auto-binds to a `Signal.State<Point>`. Object literal as the cell's value.
    - `.panel() { … }` — pug-shorthand: `<div class="panel panel-tu-XXX">` plus children. The `XXX` is a per-component hash; the `style { … }` block's selectors get the same suffix, so `.panel` styles never bleed across components.
    - `origin.x` — postfix member access. `.` doesn't collide with prefix-dot ClassRef because they sit at different positions in the grammar.
    - `origin = { … }` — assignment desugars to `origin.set(…)` when the target is a state cell.

    ## Status

    Tu is **pre-alpha (`0.1.0-alpha.8` on npm)**. The compiler, runtime, type system, full LSP, SSR + Suspense + streaming (M6.11), Custom Elements wrapper, [tu-xing](/tu-xing) UI library, and [tu-shu](/tu-shu) SSG (which builds this site) are all shipped. The repo is the public preview — the API surface may change before v0.1, but every example in [`examples/`](https://github.com/mowtwo/tu/tree/main/examples) actually runs today.

    For features explicitly **deferred** to a later milestone (live editor, per-component HMR, local reactivity, etc.) see the [Deferred backlog](/DEFERRED).
  }
}
