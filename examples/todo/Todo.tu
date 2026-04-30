// Demonstrates M1.3 control flow + M1.10 visibility + M2.5 array literals:
//   • `for item in items { ... }` — list rendering over a Signal cell
//   • `if (cond) { ... } else { ... }` — empty-state branch + chained
//     if/else if/else for the pluralized label
//   • `[a, b, c]` — array literals (M2.5) — the buttons can now construct
//     a fresh items list inline, so Todo.tu owns its controls (M1.14).

export let items = []
export let count = 0

export let label = computed(
  if (count == 0) { "no items" }
  else if (count == 1) { "1 item" }
  else { "many items" }
)

let setEmpty = () => {
  items = []
  count = 0
}
let setOne = () => {
  items = ["buy milk"]
  count = 1
}
let setMany = () => {
  items = ["buy milk", "walk the dog", "write Tu"]
  count = 3
}

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

    div(class: "controls") {
      button(onClick: setEmpty) { "empty" }
      button(onClick: setOne) { "one item" }
      button(onClick: setMany) { "three items" }
      button(onClick: () => { items = ["buy milk", "walk the dog", "write Tu", "call mom"]; count = 4 }) { "four items" }
    }
  }
}
