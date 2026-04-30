// M4 V1 demo source: a self-contained counter that runs through the
// SSR → hydrate round-trip in run.mjs.

export let count = 0
export let doubled = computed(count * 2)

let inc = () => count = count + 1
let dec = () => count = count - 1

export let SsrCounter = () => {
  div(class: "ssr-counter") {
    p { "count = " count }
    p { "doubled = " doubled }
    div(class: "controls") {
      button(onClick: dec) { "−" }
      button(onClick: inc) { "+" }
    }
  }
}
