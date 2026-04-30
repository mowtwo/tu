// M1.8 demo: two components declaring the same class name `.card` side-by-side.
// Pre-M1.8, the second component's CSS would override the first because both
// emitted `<style>.card { … }</style>` rules into the global stylesheet.
// With scoping, each component's `.card` becomes `.card-tu-{differentHash}`,
// and the two cards keep their own visual treatment.

let RedCard = (label: string) => {
  .card() { label }
  style {
    .card {
      padding: 1rem 1.25rem;
      background: #7f1d1d;
      color: #fee2e2;
      border-radius: 8px;
      font-family: system-ui, sans-serif;
    }
  }
}

let BlueCard = (label: string) => {
  .card() { label }
  style {
    .card {
      padding: 1rem 1.25rem;
      background: #1e3a8a;
      color: #dbeafe;
      border-radius: 8px;
      font-family: system-ui, sans-serif;
      font-style: italic;
    }
  }
}

let Scoped = () => {
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
