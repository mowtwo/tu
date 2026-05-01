// Tu-as-entry demo — this file *is* the Vite entry point. There is no
// index.html in this project and no .ts/.js bootstrap; `tuPage()` (in
// vite.config.ts) reads `App` from this module and synthesizes the
// surrounding HTML scaffold + mount script automatically.
//
// Anything you'd normally put in index.html — title, body class, head
// CSS link — moves into the `tuPage({ ... })` options. Anything you'd
// normally put in main.ts (mount root, signal wiring, components) lives
// here.

let count = 0
let doubled = computed(count * 2)

let inc = () => count = count + 1
let dec = () => count = count - 1

export let App = () => div(class: "wrap") {
  header {
    h1 { "Tu-as-entry" }
    p(class: "tag") { "no index.html · no main.ts · just main.tu" }
  }

  section(class: "card") {
    p(class: "row") { "count   = " count }
    p(class: "row") { "doubled = " doubled }
    div(class: "controls") {
      button(onClick: dec) { "−" }
      button(onClick: inc) { "+" }
    }
  }

  style {
    .wrap {
      max-width: 32rem;
      margin: 4rem auto;
      padding: 0 1.5rem;
      font-family: system-ui, -apple-system, sans-serif;
      color: #e2e8f0;

      header { margin-bottom: 2rem; text-align: center; }
      h1 { font-size: 2rem; margin: 0 0 0.5rem; }
    }
    .tag { color: #94a3b8; font-size: 0.9rem; margin: 0; }
    .card {
      padding: 1.5rem;
      border-radius: 12px;
      background: #1e293b;
      border: 1px solid #334155;

      .row {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 0.95rem;
        margin: 0.25rem 0;
      }
    }
    .controls {
      display: flex;
      gap: 0.5rem;
      margin-top: 1rem;

      button {
        flex: 1;
        padding: 0.5rem 1rem;
        font-size: 1.1rem;
        border-radius: 8px;
        border: 1px solid #475569;
        background: #0f172a;
        color: #e2e8f0;
        cursor: pointer;
      }
      button:hover { background: #1e293b; border-color: #64748b; }
    }
  }
}
