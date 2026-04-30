# Example: Diff (M1.7 — keyed diff)

Visual demo of two things you couldn't observe before M1.7:

- **Focus + input value survive unrelated cell mutation.** Type into the input, then bump the counter cell from outside. Pre-M1.7, the naive `replaceChildren` mount blew the input away on every render and your focus + caret + value vanished. With keyed diff, the same DOM node is reused.
- **Keyed `<li>`s move instead of being recreated on reorder.** Each `<li>` has `key: it`. Shuffling the items list moves the existing DOM nodes; any focus, animation, or local DOM state inside them survives.

There's no CLI runner — exercise this in the playground:

```bash
pnpm --filter tu-playground dev
```

…and pick **M1.7 Diff** from the sidebar. The chrome supplies controls to mutate `count` and rearrange `items`.
