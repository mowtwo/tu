// M6.0 demo — a fully-static subtree the compiler proves has zero
// reactive dependencies. The codegen folds it to a single
//   h("$static", {}, [], "<div>…</div>")
// call instead of N nested h() calls, and the runtime adopts the html
// once via <template>.innerHTML on mount. This file is the input to
// the verify.mjs script in the same directory.

export let Welcome = (): string => "Welcome"

export let App = () => div(class: "page") {
  h1 { "Tu" }
  p { "A reactive UI language with static-HTML subtree optimization." }
  ul {
    li { "Signals at the core" }
    li { "Component-level style scoping" }
    li { "SSR + Suspense + streaming" }
  }
  footer {
    span { "M6.0 baked this entire <div> into one HTML string." }
  }
}
