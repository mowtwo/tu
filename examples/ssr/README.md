# SSR + hydrate demo (M4 V1)

End-to-end round-trip in one process:

1. Compile `Counter.tu` to `dist/Counter.mjs`
2. **Server** (no DOM): import it, call `renderToString(Counter())` → HTML string
3. **Client** (jsdom): boot a fresh document with the SSR HTML pre-installed under `#app`
4. Re-import the compiled module in the client environment so the runtime's
   browser code paths bind to that document. Each `import()` is a fresh
   module instance — the server and client cells are independent, mirroring
   how real browsers re-execute the JS bundle.
5. Call `hydrate(() => Counter(), root)` — the existing DOM is ADOPTED
   (no `createElement`); event listeners attach in place; the reactive
   watcher subscribes to cell mutations.
6. Drive interactivity by dispatching `click` events. Subsequent renders
   go through the normal keyed-diff `patchChildren`.

## Run it

```bash
pnpm --filter @tu-examples/ssr demo
```

Expected: same `<button>` DOM nodes pre- and post-hydrate (identity
preserved), and the count text updates after the simulated clicks.
