# typed

Demo for the **type system** ergonomics that landed in M5.6 / M5.7:

- `interface Point { x: number; y: number }` — typed object shape.
- `let origin: Point = { x: 0, y: 0 }` — **object literal** as a let-decl
  value, with the interface driving Signal-cell inference.
- `(n: number): Point => { x: n, y: n }` — **lambda return-type
  annotation**; the body's object literal is paren-wrapped by codegen so
  JS doesn't read `=> { … }` as a function-body block.
- `computed({ tag: "point", value: make(n) })` — object literal inside a
  computed cell, with reactive `.get()` injection on cell reads.

Run:

```sh
pnpm install
pnpm demo
```
