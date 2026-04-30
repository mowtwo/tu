// M1.5 demo, refreshed for M5: an interactive counter.
//
// Tu features on display:
//   • `count = count + 1` — assigning to a top-level `let` mutates its Signal
//     cell; the compiler rewrites this to `count.set(count.get() + 1)`.
//   • `onClick: () => …` — lambda-valued props become event listeners.
//   • `.classname` ClassRef syntax — markup gets BOTH the original name and
//     the per-component hashed name (M5/F dual injection); CSS selectors
//     use the hashed name only, so styles stay scoped.
//   • Top-level CSS rules MUST be class-rooted (M5/D); compound selectors
//     like `.row > button` are nested inside the parent class via CSS4
//     nesting, which modern browsers handle natively.

export let count = 0

let dec = () => count = count - 1
let inc = () => count = count + 1
let reset = () => count = 0

export let Clicker = () => {
  .clicker() {
    p(class: .label) { "count = " count }
    .row() {
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
