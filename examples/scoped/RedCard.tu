// Standalone red `.card` component, lives in its own file. Imported into
// Scoped.tu via `import { RedCard } from "./RedCard.tu"`.
//
// M1.8 scoping is per-file: the `.card` declared here gets its own hash
// suffix that the matching `.card` in BlueCard.tu can't see, so the two
// styles coexist on the same page without collision.

export let RedCard = (label: string) => {
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
