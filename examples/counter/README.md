# Example: Counter

The first reactive Tu demo. Compiles `Counter.tu` to ESM, executes it, and shows that mutations to the `count` cell automatically propagate to `computed(...)` cells and to subsequent renders.

## Run it

From this directory:

```bash
pnpm demo
```

Or from the repo root:

```bash
pnpm --filter @tu-examples/counter demo
```

## What it shows

| Tu form | Compiled to |
|---|---|
| `let count = 0` | `new Signal.State(0)` |
| `let doubled = computed(count * 2)` | `new Signal.Computed(() => count.get() * 2)` |
| `let Counter = () => { ... }` | plain `const Counter = () => h(…)` |
| `p { count }` inside Counter | `count.get()` is read on every render |

The runner mutates the cell directly from outside (`mod.count.set(5)`) — interactive event handlers in `.tu` source come in M1.3 alongside control flow.
