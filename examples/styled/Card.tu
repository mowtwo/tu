// M1.4 demo: a component with a `style { … }` block.
//
// The `style { … }` block (no parens) is special-form: its body is preserved
// verbatim as raw CSS, emitted as a sibling `<style>` element next to the
// component's main vnode. The lambda body is a Block containing both, so
// the compiled output is a fragment array `[card, style]`.
//
// Note: M1.4 is a textual style block — no scoping rewrite yet. CSS selectors
// here are global. Scoping (auto class hash or `[data-tu-…]` attribute
// rewrite) lands in a later milestone.

let theme = "indigo"

let Card = (title: string, body: string) => {
  div(class: "card") {
    h1(class: "card__title") { title }
    p(class: "card__body") { body }
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
    }
    .card__body {
      margin: 0;
      line-height: 1.5;
      opacity: 0.85;
    }
    .card > .card__title { color: #a5b4fc; }
  }
}
