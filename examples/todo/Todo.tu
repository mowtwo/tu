// Demonstrates M1.3 control flow + M1.10 visibility + M2.5 array literals:
//   • `for item in items { ... }` — list rendering over a Signal cell
//   • `if (cond) { ... } else { ... }` — empty-state branch + chained
//     if/else if/else for the pluralized label
//   • `[a, b, c]` — array literals (M2.5) — the buttons can now construct
//     a fresh items list inline, so Todo.tu owns its controls (M1.14).

export let items = []
export let count = 0

export let b = 2

export let label = computed(
  if (count == 0) { "no items" }
  else if (count == 1) { "1 item" }
  else { "many items" }
)

let B = (a:Child)=>{
  fragement {
    "11"
    "222"
    div() {
      "333"
    }
  }
}

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

let Demo = (children:string) => {
  div {
    p { "This is a demo of M1.3 control flow and M1.10 visibility." }
    p { "The buttons below manipulate the `items` and `count` cells, which are exported from this module." }
    p { "The list of items is rendered with a `for` loop, and the label is computed with an `if/else if/else` expression." }
    children
  }
}

export let Todo = () => {

  let d = Demo("")

  div(class: "todo") {
    h1 { "Todo — " label }

    d

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
  style {
    .div::after {}
  }
}
