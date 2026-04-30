// Standalone blue `.card` component, lives in its own file. Imported into
// Scoped.tu alongside RedCard.tu — both declare a `.card` selector, both
// get a different hash suffix (M1.8 scoping), so they don't collide.

export let BlueCard = (label: string) => {
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
