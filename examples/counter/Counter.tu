let count = 0
let doubled = computed(count * 2)
let plusOne = computed(count + 1)

let Counter = () => {
  div(class: "counter") {
    p { "count   = " count }
    p { "doubled = " doubled }
    p { "+1      = " plusOne }
  }
}
