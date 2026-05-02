# M8 — Type metadata system

Status: design / pre-implementation
Owner: M8 milestone — user-decided HIGHEST PRIORITY (2026-05-02)
Closes: `M8 — Type metadata system` deferred row + the `JS legacy bans` row's `instanceof` / `typeof` / `class` / `type X = …` items.

## 1. Why this exists

Tu's current type story (post-M2) compiles `.tu` to a TypeScript shadow and lets `tsserver` infer types. **But all of that is erased at runtime.** Three real-world UI use cases force users back into JS / Zod / `external JS`:

- Form input parsing (untrusted user → typed model)
- API response checking (untrusted JSON → typed model)
- Defensive prop validation (component-boundary contracts)

We're also banning `instanceof` and `typeof` (per the JS-bans deferred row), so we owe users a strictly-better replacement before those bans land.

The plan: types stop being purely compile-time and become **first-class runtime metadata**. Every `interface` declaration produces both a TS type AND a JS value carrying its descriptor. `type.of(v)` and `type.is(v, I)` operate on those descriptors.

## 2. Core decisions (locked 2026-05-02)

1. **Strict duck typing.** Structural matching, but every declared field must be present and correctly typed. Excess properties are tolerated for now (matches TS semantics); future opt-in for "strict-no-extras" mode.
2. **Only `interface` for compound types.**
   - No `class` (banned, was never needed for UI).
   - No `struct`.
   - No `type X = …` keyword (REMOVED — current Tu's contextual `type` keyword goes away).
3. **No `extends`, no extension, no pipeline.** Interfaces are flat field declarations. Composition happens at the value level via spread.
4. **No new symbols.** API uses standard member access: `type.of(v)`, `type.is(v, I)`. No `::` namespace operator.
5. **Interface = runtime value.** `interface Foo { x: number; y: string }` declares ONE identifier `Foo` that is both a TS type AND a JS value.
6. **Anonymous interfaces.** Untyped `let a = { x: 1 }` triggers compiler-synthesized anonymous interface descriptor. Required for end-to-end metadata propagation.
7. **Primitives can't be extended.** `type.Number`, `type.String`, etc. are sealed.
8. **Object construction is ONLY `let a: Interface = {}`.** No `Object.create`, no `new Foo()` for user types.
9. **Spread inheritance.** `let b = {...a, extra: 1}` synthesizes a descriptor combining `a`'s fields with `extra`.

## 3. Surface

### 3.1 Interface declaration

```tu
interface User {
  id: number
  name: string
  email: string
}
```

Compiles to:
- TS shadow: `export interface User { id: number; name: string; email: string }`
- JS value: `export const User = type.struct("User", { id: type.Number, name: type.String, email: type.String })`

The same `User` identifier serves both purposes — TS picks up the `interface` declaration for inference; JS code sees the `const User`.

### 3.2 Construction

```tu
let alice: User = { id: 1, name: "Alice", email: "alice@example.com" }
```

Compiler emits a runtime-tagged object:

```ts
const alice = type.tag(User, { id: 1, name: "Alice", email: "alice@example.com" })
```

`type.tag` either:
- Attaches a non-enumerable `[type.symbol]` field pointing at the descriptor (option A — heaviest, most reflective), OR
- Returns the object verbatim, registers `(value, descriptor)` in a WeakMap (option B — non-invasive, garbage-collected with the value), OR
- Returns the object verbatim, no tag at all — `type.of(v)` walks the structure (option C — fastest, but lossy because shape ↔ descriptor isn't bijective for primitives like `{ x: number }` vs `{ x: number; y?: never }`).

**Default decision: option B (WeakMap registry).** Best balance of zero-overhead-when-unused (no tag eats memory if the user never calls `type.of`) and accurate-shape-recovery (registry remembers the original descriptor).

### 3.3 Spread composition

```tu
let admin: Admin = { ...alice, role: "admin" }
```

If `Admin` is declared explicitly, the `: Admin` annotation drives the descriptor. If untyped:

```tu
let admin = { ...alice, role: "admin" }
// Compiler synthesizes anon interface from sources:
//   anon = merge(descriptorOf(alice), { role: type.String })
// Registers admin → anon in the descriptor WeakMap.
```

The compiler must trace spread sources and merge their descriptors. When a source is statically unknown (e.g. a function-returned object), the synthesized descriptor falls back to `type.Object` (the open-ended root descriptor).

### 3.4 The runtime API

Exported from `@tu-lang/std`:

```tu
import { type } from "@tu-lang/std"

// Primitives — sealed module-level constants:
type.Number       // descriptor for JS number
type.String       // descriptor for JS string
type.Boolean      // descriptor for JS boolean
type.Null         // descriptor for null (Tu unifies null and undefined)
type.Function     // descriptor for any function
type.Array(T)     // constructor: descriptor for "array of T"
type.Object       // descriptor for "any object" (open-ended root)

// Introspection:
type.of(v)        // returns the descriptor — known interface > shape match > primitive > Object
type.is(v, I)     // structural check: every required field of I must be present + match type recursively

// User construction:
type.struct(name, fields)   // creates a new interface descriptor (compiler emits this for `interface` decls)
```

`type.is` is recursive — for a field declared `: number[]`, the check walks the array elements.

### 3.5 What `type.of` returns

Priority order:
1. **Tagged**: if `v` is in the WeakMap registry, return that descriptor.
2. **Primitive**: `typeof v` JS check → `type.Number` / `type.String` / etc.
3. **Array**: `Array.isArray(v)` → `type.Array(elementType)` where elementType comes from sampling the first element (or `type.Object` for empty arrays).
4. **Plain object**: walk own-enumerable keys, build an anonymous shape descriptor on the fly. This is the lossy fallback — duck-typed shape recovery.
5. **null**: `type.Null`.

This means `type.of(v)` always returns a descriptor (no `null` / `undefined` returns), and the shape may be lossy when the value isn't tagged.

### 3.6 Built-in JS types

`@tu-lang/std/type` ships descriptors for the JS built-ins Tu still allows construction of:

```tu
type.Promise      // for `new Promise(…)`
type.Map          // for `new Map()`
type.Set
type.Error
type.AbortController
type.RegExp
```

Each carries an `instanceof`-equivalent check internally (since these are nominal in JS), so `type.is(p, type.Promise)` actually does `p instanceof Promise`. **Important**: this is the ONLY place `instanceof` runs — Tu source NEVER writes `instanceof` directly.

## 4. Compiler changes

### 4.1 Lexer

- Add `interface` keyword (replaces contextual `type` keyword from M2.4).
- Remove `type` keyword recognition (becomes a normal identifier — for the runtime API).

### 4.2 Parser

- New AST node: `InterfaceDecl { name, fields: { name, type, optional }[], start, end }`.
- Drop `TypeAlias` AST node + every parser branch that produces it.
- Object literal parser: when no `: I` annotation present, mark for compiler-side anon-interface synthesis pass.

### 4.3 Codegen

- For `interface Foo { … }`:
  - Emit `export interface Foo { … }` to the TS shadow (drives tsserver inference).
  - Emit `export const Foo = type.struct("Foo", { … })` to BOTH JS and TS modes.
- For `let a: I = { … }`:
  - Emit `type.tag(I, { … })` so the registry catches the value.
- For `let a = { … }` (untyped):
  - Synthesize anon descriptor at module-level (with shape interning for repeats).
  - Emit `type.tag(__anon_42, { … })`.
- For `let b = {...a, extra: 1}`:
  - Compute merged descriptor from spread sources at compile time.
  - Emit `type.tag(__merged, { ... })`.
- Banned constructs throw with directive errors:
  - `typeof v` → "use `type.of(v)`".
  - `v instanceof T` → "use `type.is(v, T)`".
  - `type X = …` → "use `interface X { … }`".

### 4.4 Migration

The codebase has many `type X = …` aliases (in examples, tu-xing, playground). Each becomes `interface X { … }`. Audit scope:
- `examples/typed/Typed.tu`
- `examples/js-compat/JsCompat.tu`
- `examples/suspense/Page.tu`
- `playground/src/live-cases.tu` (`CaseDefinition`, `CaseFile`)
- `playground/src/Sidebar.tu` (`DemoLinkProps`)
- `packages/tu-xing/src/components/*.tu` (every Props type)

Done in the same commit as the parser change so nothing's left in `type X = …` form after.

## 5. Performance considerations

- **WeakMap registry** is GC-friendly: when a tagged value is collected, its descriptor entry goes too.
- **Shape interning**: same anonymous shape (same field names + same field types in same order) → same module-level descriptor constant. Prevents allocation explosion for `{ x: 1 }` literals appearing many times.
- **Hot-path opt-out**: future optimization — `type.tag` can no-op when `--release` mode is on (all type checks become identity, the registry is dropped, structural recovery is the only path). Don't ship the opt-out in v1; first prove the registry isn't a bottleneck.

## 6. Phases (re-stated)

- **Phase 0** — this design doc. Lands first.
- **Phase 1** — `@tu-lang/std/type` primitives + `of` / `is` for JS primitives + arrays + plain objects. Standalone; `type.of(1) === type.Number` works without compiler changes.
- **Phase 2** — `interface` keyword + codegen + repo migration (the big bang).
- **Phase 3** — anonymous interface synthesis + shape interning.
- **Phase 4** — wire the parser bans (`typeof`, `instanceof`, `type X = …`) with directive errors.
- **Phase 5** — built-in JS-type descriptors (Promise, Map, Set, Error, AbortController) + Temporal types from `@tu-lang/time`.
- **Phase 6 (M9)** — generics (`interface Box<T>`) + unions (`union(A, B)` runtime constructor or syntax) + recursive interfaces.

## 7. Open questions (resolve during implementation)

- Excess-property handling: tolerate (TS-style) or strict-reject (Tu-strict)? Default: tolerate, with a future `type.strict(I)` wrapper for strict mode.
- Interface name collision with primitives: `interface Number { … }` should error.
- Reflection on functions: `type.of(() => 42)` returns `type.Function`. Do we capture parameter / return types? Not in v1 — too expensive.
- Cross-`.tu` interface references: tsserver already handles this via the import graph. Runtime descriptors must also be importable; `interface Foo { … }` exports cleanly so this is automatic.

## 8. Banned things this directly closes

- `typeof v` (operator) → permanently banned, replaced by `type.of(v)`.
- `v instanceof T` → permanently banned, replaced by `type.is(v, T)`.
- `type X = …` (Tu's M2.4 alias keyword) → permanently removed, replaced by `interface X { … }`.
- `class` → permanently banned (already was; M8 cements the alternative).

## 9. Open compatibility migrations (for the implementation commit)

When Phase 2 lands, every `.tu` file in `packages/`, `examples/`, `playground/`, `docs/` must be migrated:
- `type Foo = { … }` → `interface Foo { … }`
- `type X = SomePrimitive | OtherShape` → flag for manual review (no `type` keyword + no unions yet means this case needs design or breaking).
- `typeof x` → `type.of(x)` (in user code; compiler-emitted `typeof` for type guards stays in TS shadow).
- `x instanceof Y` → `type.is(x, Y)`.

The audit at Phase 2 time will pick up everything; this doc just lists the categories.
