# Example: Todo (M1.3 — control flow)

Exercises every M1.3 form on one screen:

- `for item in items { … }` — list rendering
- `if (cond) { … } else { … }` — empty-state branch
- `match (n) { 0 => …, 1 => …, _ => … }` — pluralized label

Tu has no member access yet (no `items.length`), so the runner keeps a parallel `count` cell and updates both together.

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
| `match (count) { 0 => "no items", _ => "many" }` | `((__m) => __m === 0 ? "no items" : "many")(count.get())` |

The runner mutates `items.set([...])` and `count.set(n)` from outside; every render re-reads the cells and the control-flow arms pick the right branch.
