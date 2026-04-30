// M1.7 demo: showcases keyed diffing.
//
// Two scenarios you couldn't see before M1.7:
//   1. Focus survives unrelated cell mutation. Type into the input; click the
//      "tick" button to bump the counter cell. The input keeps focus and
//      preserves its caret/value because the diff reuses the same DOM node.
//   2. Keyed reorder preserves DOM identity. The list items have `key: it`,
//      so reordering them moves DOM nodes instead of recreating them — any
//      animation, focus, or input state inside an `<li>` would survive.

export let items = 0
export let count = 0

export let Diff = () => {
  div(class: "diff") {
    section(class: "section") {
      h2 { "Focus test" }
      p { "counter cell: " count }
      p(class: "muted") { "Type into the input. The chrome buttons mutate `count`. The input should keep focus + caret + value." }
      input(id: "diff-input", placeholder: "type something")
    }
    section(class: "section") {
      h2 { "Keyed list" }
      ul(class: "list") {
        for it in items {
          li(key: it, class: "list__item") { it }
        }
      }
    }
  }
  style {
    .diff { display: flex; flex-direction: column; gap: 1.5rem; max-width: 480px; }
    .section { padding: 1rem; background: #1e1b4b; border-radius: 8px; color: #e0e7ff; }
    .section h2 { margin: 0 0 0.5rem 0; font-size: 1rem; color: #a5b4fc; }
    .section p { margin: 0 0 0.5rem 0; }
    .muted { color: #a5b4fc; font-size: 0.85rem; }
    .section input {
      width: 100%; padding: 0.5rem 0.75rem;
      border: 1px solid #6366f1; background: #0f172a; color: #e0e7ff;
      border-radius: 6px; font: inherit;
    }
    .list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.25rem; }
    .list__item { padding: 0.5rem 0.75rem; background: #312e81; border-radius: 4px; font-variant-numeric: tabular-nums; }
  }
}
