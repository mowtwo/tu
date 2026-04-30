// M5.6 + M5.7 + M5.8 demo: object literals, lambda return-type
// annotations, type aliases, and member access — the typed-data ergonomics.
//
// What this exercises:
//   • `type Point = …` — a TS-style alias declared inline.
//   • `let origin: Point = { x: 0, y: 0 }` — object literal as a let-decl
//     value, with the alias driving inference for the cell.
//   • `(n: number): Point => { x: n, y: n }` — lambda return-type
//     annotation; the body is an object literal (parens-wrapped by codegen
//     so JS doesn't read it as a function-body block).
//   • `origin.x` — member access on a state-cell that holds an object.
//   • `computed({ … })` — object literal inside a computed cell.

type Point = { x: number; y: number }

export let origin: Point = { x: 0, y: 0 }

export let make = (n: number): Point => { x: n, y: n }

export let n = 1
export let snapshot = computed(make(n))

export let App = () => .panel() {
  h1 { "typed object demo" }
  p { "origin.x = " origin.x ", origin.y = " origin.y }
  p { "snapshot.x = " snapshot.x ", snapshot.y = " snapshot.y }

  style {
    .panel { font-family: system-ui, sans-serif; padding: 1rem; }
    .panel > h1 { font-size: 1.1rem; color: #312e81; }
  }
}
