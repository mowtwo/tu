// M1.7 demo, refreshed for M5: keyed diffing in action.
//
// Two scenarios you couldn't see before M1.7:
//   1. Focus / caret / typed text survive unrelated cell mutation. The
//      playground host auto-ticks `count` every 600 ms via setInterval (a
//      timer can't steal focus the way a button click does). Click into the
//      input and type — your text isn't disturbed and your cursor doesn't
//      move while the cell mutates in the background, because the diff
//      reuses the same DOM node instead of recreating it.
//   2. Keyed reorder preserves DOM identity. The list items have `key: it`,
//      so reordering them moves DOM nodes instead of recreating them.
//
// All `class:` props use M5/F ClassRef syntax (`.foo`) for dual-name
// injection: markup carries `class="foo foo-tu-XXX"` so global CSS still
// targets the unhashed name, while the component's own scoped styles
// reference the hashed form for isolation.

export let items = []
export let count = 0

export let Diff = () => .diff() {
  .section() {
    h2 { "Focus test" }
    p { "counter cell (auto-ticking): " count }
    p(class: .muted) { "Click into the input and type. The cell ticks every 600 ms in the background, but your focus, caret, and text stay put — the input DOM node is reused across re-renders, not destroyed and rebuilt." }
    input(id: "diff-input", placeholder: "type and watch the counter tick", class: .field)
  }
  .section() {
    h2 { "Keyed list" }
    ul(class: .list) {
      for it in items {
        li(key: it, class: .list__item) { it }
      }
    }
  }

  style {
    .diff { display: flex; flex-direction: column; gap: 1.5rem; max-width: 480px; }
    .section { padding: 1rem; background: #1e1b4b; border-radius: 8px; color: #e0e7ff; }
    .section h2 { margin: 0 0 0.5rem 0; font-size: 1rem; color: #a5b4fc; }
    .section p { margin: 0 0 0.5rem 0; }
    .muted { color: #a5b4fc; font-size: 0.85rem; }
    .field {
      width: 100%; padding: 0.5rem 0.75rem;
      border: 1px solid #6366f1; background: #0f172a; color: #e0e7ff;
      border-radius: 6px; font: inherit;
    }
    .list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.25rem; }
    .list__item { padding: 0.5rem 0.75rem; background: #312e81; border-radius: 4px; font-variant-numeric: tabular-nums; }
  }
}
