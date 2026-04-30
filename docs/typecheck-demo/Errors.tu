// Intentionally broken — open this in VS Code to verify the @tu/lsp
// diagnostics extension is working. Each `bad*` binding below should get a
// red squiggle on its first column with a TypeScript-style error message
// when you hover over it.
//
// (M3 V1 source-map granularity is per top-level statement, so the squiggle
// always sits on column 0 of the offending `let` line, not on the exact
// token. Token-level ranges arrive in V2.)

export let count = 0

// ── Error 1: assigning a string to a numeric Signal cell ─────────────────
// `count` infers as Signal.State<number>. The compiler rewrites
// `count = "abc"` to `count.set("abc")`, which TS catches as
// "Argument of type 'string' is not assignable to parameter of type 'number'."
export let bad1 = () => count = "abc"


// ── Error 2: calling a typed function with the wrong argument type ───────
// G expects (name: string). G(42) is a TS error 2345:
// "Argument of type 'number' is not assignable to parameter of type 'string'."
export let G = (name: string) => p { name }
export let bad2 = () => G(42)


// ── Error 3: arithmetic on a string param ────────────────────────────────
// triple expects a number; calling triple("nope") fails the same way.
export let triple = (n: number) => n * 3
export let bad3 = () => triple("nope")


// ── Clean reference (should NOT have a red line) ─────────────────────────
// This one is well-typed end-to-end.
export let good = () => G("World")
