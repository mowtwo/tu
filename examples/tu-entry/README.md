# tu-entry

Demonstrates **Tu as the Vite entry point** — no `index.html`, no
`main.ts` bootstrap. Just `src/main.tu`.

```ts
// vite.config.ts
import tu, { tuPage } from '@tu-lang/vite'

export default {
  plugins: [
    tu(),
    tuPage({ entry: 'src/main.tu', title: 'Tu app' }),
  ],
}
```

`tuPage()` synthesizes the HTML scaffold, imports the entry file's
exported `App`, and mounts it. All page-level config (title, body
class, head HTML) moves out of `index.html` and into the plugin
options.

## Run

```sh
pnpm install
pnpm --filter @tu-examples/tu-entry dev
```

## Files

- `vite.config.ts` — `tu()` + `tuPage({ entry: 'src/main.tu' })`
- `src/main.tu` — exports `App`; this *is* the entry
