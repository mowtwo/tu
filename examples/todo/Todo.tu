// Demonstrates M1.3 control flow plus M1.10 visibility:
//   • `for item in items { ... }` — list rendering
//   • `if (cond) { ... } else { ... }` — empty-state branch + chained
//     if/else if/else for the pluralized label (a `match` form was
//     removed in M1.11 to avoid colliding with the TC39 Pattern Matching
//     proposal).
//
// Tu has no member access yet (no `items.length`), so we keep a separate `count` cell
// and update both together from the runner.

export let items = 0
export let count = 0

export let label = computed(
  if (count == 0) { "no items" }
  else if (count == 1) { "1 item" }
  else { "many items" }
)

export let Todo = () => {
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
