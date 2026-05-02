# `@tu-lang/dom`

The browser-only half of the Tu runtime. Importing from this package is
the **explicit opt-in** to the DOM platform — Tu's compiler does not
auto-import it.

```tu
import { mount } from "@tu-lang/dom"
import { App } from "./App.tu"

mount(() => App(), document.getElementById("root"))
```

What lives here:

- **Mount entries** — `mount`, `hydrate`, `defineCustomElement`.
- **Typed re-exports of DOM globals** — `document`, `window`, `Event`,
  `MouseEvent`, `KeyboardEvent`, `InputEvent`, `Element`, `HTMLElement`,
  `HTMLInputElement`, `Node`, `Text`, `EventListener`, `RequestInit`,
  `Response`, `FormData`, `URLSearchParams`, `AbortController`, etc.
  These let Tu user code reach for browser types **by name** without
  pulling DOM into Tu's ambient lib.

What does **not** live here (stays in `@tu-lang/runtime`):

- `Signal`, `VNode`, `Child`, `h`, `Fragment` — universal vnode
  construction and reactive primitives.
- `renderToString`, `renderPage`, `renderPageHtml` — SSR. Works in Node
  with no DOM around.

The boundary lets a Tu program target SSR-only, a custom non-DOM
renderer, or a Web Worker context without ever paying the cost of
having `document` ambiently typed in scope. Anything that touches the
DOM has to come through this package.
