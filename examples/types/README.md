# types — M8 + M9 demo

End-to-end showcase of Tu's type metadata + structured exception system:

- **`interface User { … }`** — declares BOTH a TS type AND a runtime
  descriptor const under the same identifier. `type.of(value)` returns
  the descriptor for any tagged value; `type.is(value, User)` is a
  strict-duck-typing predicate.
- **`Exception ValidationError { field: string }`** — like `interface`,
  but the runtime const is a callable factory `(message, props?) =>
  Error` that produces a tagged Error subclass with stack-trace
  capture. Passable to `type.is(e, ValidationError)`, which narrows the
  value in LSP hovers and diagnostics.
- **`type.as(value, descriptor, castFn?)`** — runtime cast that
  validates `value` against `descriptor` and returns it typed.
  Throws `TypeMismatchError` on mismatch.
- **`(): R ? E1 | E2 => …`** — declares a function's allowed throws
  set. The M9 LSP checker (Phase 4) flags `throw OtherError(…)` not
  in the clause as a build error.

Run:

```sh
pnpm --filter @tu-examples/types test
```

Output should print a report listing the descriptor identity checks,
the parseUser round-trip on valid/invalid input, and filtered catch
dispatch via `catch if ValidationError as e`.
