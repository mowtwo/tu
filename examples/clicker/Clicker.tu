// M1.5 demo: an interactive counter.
//
// Three new things appear here:
//   • `count = count + 1` — assigning to a top-level `let` mutates its Signal
//     cell; the compiler rewrites this to `count.set(count.get() + 1)`.
//   • `onClick: () => …` — lambda-valued props become event listeners; the
//     runtime maps `on{Capital}` props to `addEventListener('click', …)`.
//   • Calling `mount(Clicker, container)` (from the runner) materializes the
//     component into real DOM and re-renders on every cell change.

let count = 0

let dec = () => count = count - 1
let inc = () => count = count + 1
let reset = () => count = 0

let Clicker = () => {
  div(class: "clicker") {
    p(class: "label") { "count = " count }
    div(class: "row") {
      button(onClick: dec) { "−" }
      button(onClick: reset) { "reset" }
      button(onClick: inc) { "+" }
    }
  }
  style {
    .clicker { font-family: system-ui, sans-serif; padding: 1rem; }
    .label { font-size: 1.5rem; margin: 0 0 0.5rem 0; }
    .row { display: flex; gap: 0.5rem; }
    .row > button {
      padding: 0.5rem 1rem;
      border: 1px solid #6366f1;
      background: #1e1b4b;
      color: #e0e7ff;
      border-radius: 6px;
      cursor: pointer;
    }
    .row > button:hover { background: #312e81; }
  }
}
