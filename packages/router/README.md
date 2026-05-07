# @tu-lang/router

Universal route matching and SSR helpers for Tu.

```ts
import { createRouter, renderRoute } from '@tu-lang/router'
import { h } from '@tu-lang/runtime'

const router = createRouter([
  { path: '/', handler: () => h('h1', {}, ['Home']) },
  { path: '/users/:id', handler: ({ params }) => h('p', {}, [params.id]) },
])

const html = await renderRoute(router, '/users/alice', { title: 'User' })
```

Routes support static segments, `:params`, and trailing catch-alls (`*` or
`*name`). The package is DOM-free; browser history integration can layer on top
without changing the SSR contract.
