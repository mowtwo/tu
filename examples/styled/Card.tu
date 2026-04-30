// M1.4 + M1.8 demo: a component with a scoped `style { … }` block.
//
// M1.4 introduced the `style { … }` block (raw CSS preserved verbatim, emitted
// as a sibling `<style>` element). M1.8 added scoping: classes referenced
// symbolically with `.classname` (instead of stringly `class: "classname"`)
// get a per-component hash suffix in both the markup attribute and the CSS
// selector, so two components declaring the same class name don't collide.
//
// The pug-style shorthand `.body() { … }` desugars to `div(class: .body)`.

let Card = (title: string, body: string) => {
  .card() {
    h1(class: .card__title) { title }
    .body() { body }
  }
  style {
    .card {
      max-width: 360px;
      padding: 1rem 1.25rem;
      border-radius: 8px;
      background: #1e1b4b;
      color: #e0e7ff;
      font-family: system-ui, sans-serif;
    }
    .card__title {
      margin: 0 0 0.5rem 0;
      font-size: 1.25rem;
      letter-spacing: -0.01em;
      color: #a5b4fc;
    }
    .body {
      margin: 0;
      line-height: 1.5;
      opacity: 0.85;
    }
  }
}
