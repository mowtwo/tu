export let count = 0
export let doubled = computed(count * 2)
export let plusOne = computed(count + 1)

export let Counter = () => {
  div(class: "counter") {
    p { "count   = " count }
    p { "doubled = " doubled }
    p { "+1      = " plusOne }
  }
}
