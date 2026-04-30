# Example: Clicker (M1.5 — events + mount)

The first **interactive** Tu component. Three new pieces show up here:

- `count = count + 1` — assignment in expression position. The compiler rewrites this to `count.set(count.get() + 1)` because `count` is a top-level state cell.
- `onClick: () => …` — lambda-valued props become DOM event listeners. The runtime maps any `on{CapitalLetter}` prop name to `addEventListener('click', …)` (lowercased).
- `mount(thunk, container)` — runtime API that materializes the component into real DOM and re-renders on every cell change. Browser-only; the runner uses jsdom to simulate a browser in Node.

## Run it

```bash
pnpm --filter @tu-examples/clicker demo
```

The runner mounts the component, simulates clicks, and prints the DOM after each. Counter goes up, down, resets — all via cell mutations driven from inside `.tu` source.

## What it shows

| Tu form | Compiled to |
|---|---|
| `count = count + 1` | `count.set((count.get() + 1))` |
| `onClick: dec` (top-level fn ref) | `{ "onClick": dec }` (passed through, no `.get()`) |
| `button(onClick: () => …) { "+" }` | `h("button", { "onClick": () => … }, ["+"])` |

## Why jsdom?

`mount()` requires `document`, `Element`, etc. — browser APIs. Rather than depend on a bundler + real browser for a CLI demo, we boot jsdom in Node and install its globals before mounting. This lets us drive the demo and assert behavior with plain `pnpm demo`.

For a real-browser demo you'd:
1. Compile the `.tu` source with `@tu-lang/compiler`.
2. Bundle `@tu-lang/runtime` for browser ESM (Vite / esbuild).
3. Call `mount(Clicker, document.getElementById('app'))` from a `<script type="module">`.

A bundler-integrated dev server lands in M5.

## Type-check + `.d.ts` emit (M2)

```bash
pnpm --filter @tu-examples/clicker typecheck
```

This runs `compileToTS()` on `Clicker.tu`, drops the result next to the source as `Clicker.ts`, then shells out to `tsc` twice — once with `--noEmit` to verify it type-checks, once with `--emitDeclarationOnly` to produce `dist/Clicker.d.ts`.

Output:

```ts
import { Signal } from '@tu-lang/runtime';
export declare const count: Signal.State<number>;
export declare const Clicker: () => import("@tu-lang/runtime").VNode[];
```

Notice:
- `count` is typed `Signal.State<number>` — inferred by tsserver from `new Signal.State(0)` in the compiled output. No type annotation in the Tu source needed.
- `Clicker` is `() => VNode[]` — also inferred from its body returning a fragment array (the `[divVNode, styleVNode]` we hand to mount).
- The private helpers `dec`, `inc`, `reset` do NOT appear in the `.d.ts`. M1.10's `let` (private) vs `export let` (public) distinction reaches all the way into the public type surface.
