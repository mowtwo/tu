export let count = 0
export let doubled = computed(count * 2)
export let plusOne = computed(count + 1)

let inc = () => count = count + 1
let dec = () => count = count - 1
let reset = () => count = 0

export let Counter = () => {
  div(class: "counter") {
    p { "count   = " count }
    p { "doubled = " doubled }
    p { "+1      = " plusOne }
    div(class: "controls") {
      button(onClick: dec) { "−" }
      button(onClick: reset) { "reset" }
      button(onClick: inc) { "+" }
    }
  }
}
