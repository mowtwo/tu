// Demonstrates M1.3 control flow:
//   • `for item in items { ... }` — list rendering
//   • `if (cond) { ... } else { ... }` — empty-state branch
//   • `match (n) { 0 => ..., 1 => ..., _ => ... }` — pluralized label
//
// Tu has no member access yet (no `items.length`), so we keep a separate `count` cell
// and update both together from the runner.

let items = 0
let count = 0

let label = computed(match (count) {
  0 => "no items"
  1 => "1 item"
  _ => "many items"
})

let Todo = () => {
  div(class: "todo") {
    h1 { "Todo — " label }

    if (count > 0) {
      ul {
        for item in items {
          li { item }
        }
      }
    } else {
      p(class: "empty") { "Add something to get started." }
    }
  }
}
