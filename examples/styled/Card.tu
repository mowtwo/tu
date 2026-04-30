// M1.4 + M1.8 + M5 demo: a component with a scoped `style { … }` block,
// children-as-positional-arg, and dual-class injection.
//
// Tu features in play:
//   • `.classname` ClassRef — markup gets BOTH the original name AND the
//     per-component hashed name (M5/F), so global CSS / dev-tools can
//     still target the unhashed `.card`. The component's own scoped
//     styles reference the hashed form for isolation.
//   • `style { … }`'s top-level rules must be class-rooted (M5/D).
//   • Capitalized `Card` is treated as a real function (M5 V1) — call as
//     `Card("title", "body")` or compose via `Card("title") { children }`.

export let Card = (title: string, body: string) => .card() {
  h1(class: .card__title) { title }
  .body() { body }

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
