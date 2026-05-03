// M8 + M9 demo — interface as runtime descriptor, type.of, type.is,
// type.as, Exception with stack trace + throws clauses.
//
// Compiled output: every `interface` and `Exception` decl produces
// BOTH a TS type AND a runtime const value with the matching identifier.
// `type.tag` is auto-injected at typed-let sites so `type.of(alice)`
// returns the User descriptor (reference-equal, not duck-typing).

// `type` namespace is auto-imported when this file declares any
// `interface` / `Exception` (M8 codegen rule). User-facing code
// can call `type.of(v)` / `type.is(v, T)` / `type.as(v, T)` /
// `type.Object` without writing the import.

// ── Interfaces ────────────────────────────────────────────────────
//
// `interface User { … }` declares BOTH the TS type AND a runtime
// `const User = type.struct("User", […])` descriptor.
interface User { id: number; name: string; email: string | null }
interface Admin { id: number; name: string; role: string }

// ── Exceptions ────────────────────────────────────────────────────
//
// Like `interface` but the runtime const is a callable factory that
// produces a tagged Error with stack trace. Construction is fixed-form:
//   ValidationError("message", { field: "id" })
// — no `new` keyword, no `this` binding.
Exception ValidationError { field: string }
Exception NotFoundError { resource: string }

// ── Functions with throws clauses ─────────────────────────────────
//
// `(): R ? E1 | E2 => …` declares the function's allowed throws set.
// The M9 LSP checker (Phase 4) will flag a `throw OtherError(…)`
// inside this body if OtherError isn't in the clause.
let parseUser = (raw: unknown): User ? ValidationError => {
  if (type.is(raw, type.Object)) {
    return type.as(raw, User)
  }
  throw ValidationError("expected an object", { field: "(root)" })
}

let lookupUser = (id: number): User ? NotFoundError | ValidationError => {
  if (id < 0) {
    throw ValidationError("id must be non-negative", { field: "id" })
  }
  if (id > 100) {
    throw NotFoundError("no such user", { resource: "user/" + id })
  }
  return { id, name: "User-" + id, email: null }
}

// ── Reactive state with auto-tag injection ────────────────────────
//
// `let alice: User = { … }` triggers the M8 Phase 2.5 `type.tag(User, …)`
// wrapper so `type.of(alice) === User` (reference equality).
export let alice: User = { id: 1, name: "Alice", email: "alice@example.com" }
export let bob: Admin = { id: 2, name: "Bob", role: "admin" }

// ── Demo entry: round-trip a JSON payload through the types ───────
export let runDemo = (): { ok: boolean; report: string } => {
  let lines: string[] = []
  lines = [...lines, "alice descriptor === User: " + (type.of(alice) == User)]
  lines = [...lines, "alice is User: " + type.is(alice, User)]
  lines = [...lines, "alice is Admin: " + type.is(alice, Admin)]
  lines = [...lines, "bob is Admin: " + type.is(bob, Admin)]

  // Untrusted JSON input — type.as either validates or throws.
  let goodInput: unknown = { id: 42, name: "Eve", email: null }
  try {
    let parsed = parseUser(goodInput)
    lines = [...lines, "parsed: " + parsed.name + " (id=" + parsed.id + ")"]
  } catch (e: unknown) {
    lines = [...lines, "unexpected throw: " + (e?.message ?? String(e))]
  }

  let badInput: unknown = "not even an object"
  try {
    parseUser(badInput)
    lines = [...lines, "(should have thrown)"]
  } catch (e: ValidationError | unknown) {
    if (type.is(e, ValidationError)) {
      lines = [...lines, "got ValidationError: " + (e?.message ?? "")]
    } else {
      lines = [...lines, "got non-ValidationError: " + String(e)]
    }
  }

  // Lookup that throws specific error types.
  try {
    lookupUser(-1)
  } catch (e: ValidationError | NotFoundError | unknown) {
    let kind = if (type.is(e, ValidationError)) { "ValidationError" }
               else if (type.is(e, NotFoundError)) { "NotFoundError" }
               else { "unknown" }
    lines = [...lines, "lookupUser(-1) → " + kind]
  }

  return { ok: true, report: lines.join("\n") }
}
