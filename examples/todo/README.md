# Example: Todo (M1.3 — control flow)

Exercises every M1.3 form on one screen:

- `for item in items { … }` — list rendering
- `if (cond) { … } else { … }` — empty-state branch
- `else if` chains — pluralized label

The demo keeps a parallel `count` cell so the label can focus on control-flow behavior.

## Run it

From this directory:

```bash
pnpm demo
```

Or from the repo root:

```bash
pnpm --filter @tu-examples/todo demo
```

## What it shows

| Tu form | Compiled to |
|---|---|
| `if (count > 0) { … } else { … }` | `(count.get() > 0 ? (…) : (…))` |
| `for item in items { li { item } }` | `Array.from(items.get(), (item) => h("li", {}, [item]))` |
| `if (count == 0) { "no items" } else if (count == 1) { "1 item" } else { "many items" }` | nested conditional expression in emitted JS |

The runner mutates `items.set([...])` and `count.set(n)` from outside; every render re-reads the cells and the control-flow arms pick the right branch.
