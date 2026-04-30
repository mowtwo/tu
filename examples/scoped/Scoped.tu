// M1.8 + M2.1 demo: cross-`.tu` import composing two components that each
// declare a `.card` style. M1.8 scoping ensures the two `.card`s don't bleed
// across components. M2.1 adds the `import { … } from "./other.tu"` syntax
// that lets each component live in its own file.

import { RedCard } from "./RedCard.tu"
import { BlueCard } from "./BlueCard.tu"

export let Scoped = () => {
  div(class: .stage) {
    RedCard("I'm a red `.card`")
    BlueCard("I'm a blue `.card` — same class name, different scope")
  }
  style {
    .stage {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      max-width: 480px;
    }
  }
}
