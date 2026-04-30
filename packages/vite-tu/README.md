# @tu-lang/vite

Vite plugin that compiles Tu source modules (`.tu`) on import.

```ts
// vite.config.ts
import tu from '@tu-lang/vite'
export default { plugins: [tu()] }
```

```js
// src/main.js
import { Greeting } from './hello.tu'
import { mount } from '@tu-lang/runtime'

mount(() => Greeting('World'), document.getElementById('app'))
```

The plugin's `load` hook reads the `.tu` file, calls `compile()` from `@tu-lang/compiler`, and returns the result. Vite handles the rest like any JS module — including HMR via full module re-import on save.

Per-component fine-grained HMR boundaries are future work.
