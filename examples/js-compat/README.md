# js-compat

How far does Tu reach into JavaScript and TypeScript? This single-file
demo compiles every "modern JS" feature Tu currently supports into one
runnable `.tu` source.

What you'll see exercised:

- **Type aliases** — `type Todo = { … }`.
- **Object spread** — `{ ...todo, done: true }`.
- **Array spread + array methods** — `[...todos, fresh]`, `.filter`, `.map`.
- **Template literals** — `` `${name} has ${n} todos` ``.
- **Optional chaining + nullish coalescing** — `user?.name ?? "anon"`.
- **Ternary** — `n > 0 ? "some" : "none"`.
- **Compound assignment + update** — `total += 1`, `i++`.
- **try / catch / finally + throw** — recoverable async errors.
- **async / await + Promise** — `await loadProfile()`.
- **Regex literal** — `/^[a-z]+$/i.test(slug)`.
- **`external JS` escape hatch** — drop into raw JS for one helper Tu
  can't easily express (here: imperative `performance.now()` plus a
  tight index-based array swap).

Run:

```sh
pnpm install
pnpm --filter @tu-examples/js-compat demo
```

The runner compiles `JsCompat.tu`, calls `runDemo()` end-to-end, mounts
the component to a jsdom DOM, and prints both the API output and the
rendered HTML.
