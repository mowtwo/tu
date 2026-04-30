// M5 demo: components + children + Fragment.
//
// What this exercises:
//   • A capitalized identifier is a real component (function call), not
//     an HTML tag. `Card("title") { children }` compiles to
//     `Card("title", [children])` — the trailing block becomes the
//     final positional argument.
//   • Component lambdas conventionally take `children` as the last
//     parameter. The annotation `(children: Child[])` resolves the
//     `VNode` type via the auto-injected runtime import.
//   • `Fragment { … }` (from @tu-lang/runtime) lets a component return
//     multiple sibling vnodes without an enclosing wrapper element.
//   • Local `let` inside a block body is a plain const (not a Signal
//     cell), useful for closures and small computations.

import { Fragment } from "@tu-lang/runtime"

// Layout component: renders a header + the children + a footer.
export let Layout = (title: string, children: Child[]) => Fragment {
  header(class: .header) { h1 { title } }
  .body() { children }
  footer(class: .footer) { "© 2026" }

  style {
    .header { padding: 1rem; background: #312e81; color: #e0e7ff; }
    .body { padding: 1rem; }
    .footer { padding: 0.5rem 1rem; background: #1e1b4b; color: #a5b4fc; font-size: 0.85rem; }
  }
}

// Card with a derived greeting via a local `let` inside the body.
export let Card = (name: string, children: Child[]) => {
  let greeting = "Hello, " + name + "!"
  .card() {
    h2 { greeting }
    children
  }

  style {
    .card {
      padding: 1rem 1.25rem;
      border-radius: 8px;
      background: #1e1b4b;
      color: #e0e7ff;
      margin: 0.5rem 0;
    }
  }
}

// App composes Layout and Card.
export let App = () => Layout("Composition demo") {
  Card("Alice") {
    p { "Lorem ipsum, with reactive bits sprinkled in." }
  }
  Card("Bob") {
    p { "Each Card receives its own children block." }
    p { "And renders a derived greeting from a local let." }
  }
}
