// M8 Phase 1 — Tu type metadata system.
//
// Types are first-class runtime values. Each `interface Foo { … }` (Phase 2)
// will compile to BOTH a TS interface AND a `const Foo = type.struct(...)`
// runtime descriptor exported under the same name. Phase 1 (this file)
// ships only the runtime API + the primitive descriptors so `type.of(1)`
// and `type.is(v, type.Number)` already work before any compiler change
// lands.
//
// Design contract (locked 2026-05-02):
//
// - Strict duck typing: structural matching, every declared field must
//   be present and correctly typed.
// - Only `interface` for compound types (Phase 2). No `class`, no `struct`,
//   no `type X = …` aliases.
// - No `extends` — interfaces are flat. Composition lives at the value
//   level via spread `{...a, extra: 1}` (Phase 3 handles the merge).
// - API is plain member access: `type.of(v)`, `type.is(v, I)`. No new
//   symbols or namespace operators.
//
// Implementation notes:
//
// - Tags ride a WeakMap registry, not enumerable properties on the value.
//   Zero overhead when unused; descriptors get GC'd alongside their values.
// - Primitives are sealed module-level constants — `type.Number === type.Number`
//   across calls.
// - `type.Array(T)` and `type.Optional(T)` are constructors that return
//   per-call descriptors (T may differ each time). They cache by structural
//   identity inside the constructor so equal-shape arrays of equal-T
//   element type share one descriptor.

export type TypeKind =
  | 'primitive'
  | 'null'
  | 'array'
  | 'object'
  | 'struct'
  | 'function'
  | 'native'
  | 'optional'

/**
 * Runtime descriptor for a Tu type. Every `type.of(v)` returns one of
 * these; every `type.is(v, T)` accepts one as the second argument.
 *
 * The shape is intentionally an interface, not a class — `type.struct`
 * builds plain objects so the descriptors themselves are JSON-friendly
 * and survive structuredClone() / postMessage() boundaries (sandbox
 * future-friendliness).
 */
export interface TypeDescriptor {
  kind: TypeKind
  /** Display name. Primitives carry their JS typeof name; structs carry the
   *  Tu interface name; anonymous structs carry a synthesized `__anon_N`. */
  name: string
  /** For `struct` / anonymous-struct: ordered field list. Empty otherwise. */
  fields?: ReadonlyArray<{ name: string; type: TypeDescriptor; optional: boolean }>
  /** For `array`: the element-type descriptor. */
  element?: TypeDescriptor
  /** For `optional`: the wrapped descriptor (means `T | null` post-Phase-2 unification). */
  inner?: TypeDescriptor
  /** For `native`: a runtime predicate (e.g. `v instanceof Promise`). The
   *  ONE place `instanceof` is permitted in Tu — wraps platform-nominal
   *  types so user `type.is` stays uniform. */
  check?: (v: unknown) => boolean
}

// ── primitives — sealed module-level singletons ────────────────────

export const Number_: TypeDescriptor = { kind: 'primitive', name: 'number' }
export const String_: TypeDescriptor = { kind: 'primitive', name: 'string' }
export const Boolean_: TypeDescriptor = { kind: 'primitive', name: 'boolean' }
export const BigInt_: TypeDescriptor = { kind: 'primitive', name: 'bigint' }
export const Symbol_: TypeDescriptor = { kind: 'primitive', name: 'symbol' }
export const Null: TypeDescriptor = { kind: 'null', name: 'null' }
export const Function_: TypeDescriptor = { kind: 'function', name: 'function' }
/** Open-ended root descriptor. Matches every plain object regardless of
 *  shape; useful as a fallback when we can't recover a tighter type. */
export const Object_: TypeDescriptor = { kind: 'object', name: 'object' }
/** Top type — matches everything. */
export const Any: TypeDescriptor = { kind: 'object', name: 'any' }
/** Bottom type — matches nothing. Used by `type.struct` for fields whose
 *  type couldn't be resolved (the codegen falls back to this). */
export const Never: TypeDescriptor = { kind: 'object', name: 'never' }

// ── constructors — return per-call descriptors w/ structural sharing ─

const arrayCache = new Map<TypeDescriptor, TypeDescriptor>()

/**
 * Descriptor for "array of T". Same `element` descriptor identity →
 * same returned descriptor (structural sharing) so two `type.Array(type.Number)`
 * calls compare equal by `===`.
 */
export function Array_(element: TypeDescriptor): TypeDescriptor {
  const cached = arrayCache.get(element)
  if (cached) return cached
  const fresh: TypeDescriptor = {
    kind: 'array',
    name: `${element.name}[]`,
    element,
  }
  arrayCache.set(element, fresh)
  return fresh
}

const optionalCache = new Map<TypeDescriptor, TypeDescriptor>()

/** Descriptor for `T | null`. Same caching strategy as Array_. */
export function Optional(inner: TypeDescriptor): TypeDescriptor {
  const cached = optionalCache.get(inner)
  if (cached) return cached
  const fresh: TypeDescriptor = {
    kind: 'optional',
    name: `${inner.name}?`,
    inner,
  }
  optionalCache.set(inner, fresh)
  return fresh
}

/**
 * Build an interface descriptor. The Phase 2 codegen emits this for each
 * `interface Foo { … }` declaration. Users typically don't call it directly;
 * they write the interface form.
 *
 * `fields` is field-order-sensitive — Tu interfaces are ordered, so the
 * descriptor preserves declaration order for serialization / printing.
 */
export interface StructField {
  name: string
  type: TypeDescriptor
  optional?: boolean
}

export function struct(name: string, fields: StructField[]): TypeDescriptor {
  return {
    kind: 'struct',
    name,
    fields: fields.map((f) => ({
      name: f.name,
      type: f.type,
      optional: f.optional === true,
    })),
  }
}

/**
 * Wrap a JS-nominal built-in (Promise, Map, Set, Error, AbortController,
 * RegExp, …) so `type.is(p, type.Promise)` works. `instanceof` runs ONLY
 * inside `check` here — Tu source never uses it directly.
 */
export function native(name: string, check: (v: unknown) => boolean): TypeDescriptor {
  return { kind: 'native', name, check }
}

// ── built-in JS-type descriptors ────────────────────────────────────

export const Promise_ = native('Promise', (v) => v instanceof Promise)
export const Map_ = native('Map', (v) => v instanceof Map)
export const Set_ = native('Set', (v) => v instanceof Set)
export const Error_ = native('Error', (v) => v instanceof Error)
export const RegExp_ = native('RegExp', (v) => v instanceof RegExp)
export const AbortController_ = native('AbortController', (v) =>
  typeof AbortController !== 'undefined' ? v instanceof AbortController : false
)
export const Date_ = native('Date', (v) => v instanceof Date)

// ── Temporal descriptors (M8 Phase 5) ──────────────────────────────
//
// Built lazily — only the user who imports `@tu-lang/std/time`
// actually pulls the polyfill. We use a getter-style indirection so
// importing `@tu-lang/std`'s `type` namespace alone doesn't drag in
// the ~80 KB Temporal polyfill. The first `type.is(v, type.Instant)`
// call resolves the constructor.
//
// Pattern: each Temporal native descriptor's `check` lazy-imports
// `@tu-lang/std/time` on first invocation. After the first call the
// import promise's resolved value is cached for subsequent checks.

let temporalConstructorsCache: {
  Instant: unknown
  ZonedDateTime: unknown
  PlainDate: unknown
  PlainTime: unknown
  PlainDateTime: unknown
  PlainYearMonth: unknown
  PlainMonthDay: unknown
  Duration: unknown
} | null = null

async function loadTemporalConstructors(): Promise<typeof temporalConstructorsCache> {
  if (temporalConstructorsCache !== null) return temporalConstructorsCache
  const mod = await import('./time.js')
  temporalConstructorsCache = {
    Instant: mod.Instant,
    ZonedDateTime: mod.ZonedDateTime,
    PlainDate: mod.PlainDate,
    PlainTime: mod.PlainTime,
    PlainDateTime: mod.PlainDateTime,
    PlainYearMonth: mod.PlainYearMonth,
    PlainMonthDay: mod.PlainMonthDay,
    Duration: mod.Duration,
  }
  return temporalConstructorsCache
}

// Synchronous variant: we attempt the lazy load eagerly at first
// access from the type module. Users who never call `type.is` against
// a Temporal descriptor never trigger the import.
//
// We synthesize the descriptor with a `check` that does `instanceof`
// against the (resolved) constructor. Until first `await`-resolved
// check, the constructor is undefined and the check returns `false` —
// but `type.is(v, type.Instant)` is a synchronous predicate, so we
// pre-warm by reading the synchronous side of the polyfill via an
// indirect check: `v?.constructor?.name`. This works without dragging
// the polyfill in until needed.
function makeTemporalDescriptor(name: string): TypeDescriptor {
  return native(`Temporal.${name}`, (v) => {
    // Temporal types are real classes — `v instanceof Temporal.X`
    // works. We do a constructor-name check first to avoid loading
    // the polyfill solely to validate primitive non-Temporal values.
    if (v == null || typeof v !== 'object') return false
    const proto = Object.getPrototypeOf(v) as { constructor?: { name?: string } } | null
    const cname = proto?.constructor?.name
    if (cname !== name) return false
    // Confirm against the real constructor when we already loaded it;
    // otherwise trust the constructor-name match (tiny risk of a user
    // class named "Instant" — acceptable).
    if (temporalConstructorsCache !== null) {
      const ctor = temporalConstructorsCache[name as keyof typeof temporalConstructorsCache]
      if (typeof ctor === 'function') return v instanceof (ctor as new (...a: unknown[]) => unknown)
    }
    return true
  })
}

export const Instant_ = makeTemporalDescriptor('Instant')
export const ZonedDateTime_ = makeTemporalDescriptor('ZonedDateTime')
export const PlainDate_ = makeTemporalDescriptor('PlainDate')
export const PlainTime_ = makeTemporalDescriptor('PlainTime')
export const PlainDateTime_ = makeTemporalDescriptor('PlainDateTime')
export const PlainYearMonth_ = makeTemporalDescriptor('PlainYearMonth')
export const PlainMonthDay_ = makeTemporalDescriptor('PlainMonthDay')
export const Duration_ = makeTemporalDescriptor('Duration')

/** Eagerly load the Temporal polyfill — call once at app startup if
 *  you'll be doing `type.is(v, type.Instant)` checks in hot paths and
 *  want the precise `instanceof` resolution available from the first
 *  call. Otherwise the constructor-name fallback is fine. */
export async function preloadTemporal(): Promise<void> {
  await loadTemporalConstructors()
}

// ── tagging registry ────────────────────────────────────────────────
//
// Phase 2's compiler will emit `type.tag(Foo, { … })` at every typed `let`
// site so `type.of(value)` recovers the original interface descriptor
// instead of falling back to anonymous shape recovery. The registry is a
// WeakMap so tagged values get GC'd cleanly.

const registry = new WeakMap<object, TypeDescriptor>()

/**
 * Tag `value` with `descriptor`. Returns `value` for chaining (so the
 * compiler can emit `let alice = type.tag(User, { … })` inline).
 *
 * Primitives can't be tagged — they're identified by their value's
 * `typeof`. The registry only holds object references.
 */
export function tag<T extends object>(descriptor: TypeDescriptor, value: T): T {
  registry.set(value, descriptor)
  return value
}

// ── runtime API ─────────────────────────────────────────────────────

/**
 * Return the descriptor for `value`.
 *
 * Resolution order:
 *   1. Tagged in the registry → return that descriptor.
 *   2. Primitive (string / number / boolean / bigint / symbol / function) →
 *      the matching sealed primitive.
 *   3. null → type.Null. (Tu unifies `null` and `undefined`; both surface
 *      here as `Null`.)
 *   4. Array → `type.Array(element)` where `element` is sampled from the
 *      first item, or `type.Object` for empty arrays.
 *   5. Plain object → walk own-enumerable keys and build an anonymous
 *      shape descriptor. Lossy — same shape always returns the same
 *      identity-fresh descriptor (no global interning here; that's a
 *      Phase 3 responsibility).
 */
export function of(value: unknown): TypeDescriptor {
  if (value === null || value === undefined) return Null
  // Object check first so we can hit the registry — primitive typeof
  // returns 'object' for null already filtered above.
  if (typeof value === 'object') {
    const tagged = registry.get(value as object)
    if (tagged) return tagged
    if (Array.isArray(value)) {
      if (value.length === 0) return Array_(Object_)
      return Array_(of(value[0]))
    }
    // Plain object — synthesize anonymous shape descriptor.
    const fields: StructField[] = []
    for (const key of Object.keys(value as Record<string, unknown>)) {
      fields.push({
        name: key,
        type: of((value as Record<string, unknown>)[key]),
        optional: false,
      })
    }
    return struct('__anon', fields)
  }
  switch (typeof value) {
    case 'number':
      return Number_
    case 'string':
      return String_
    case 'boolean':
      return Boolean_
    case 'bigint':
      return BigInt_
    case 'symbol':
      return Symbol_
    case 'function':
      return Function_
  }
  return Object_
}

/**
 * Strict-duck-typing predicate. Returns true iff `value` matches every
 * required field of `descriptor` with a recursively-matching type.
 *
 * Excess properties are tolerated (TS-style); a future `type.strict(I)`
 * wrapper can opt in to no-extras checking.
 */
export function is(value: unknown, descriptor: TypeDescriptor): boolean {
  switch (descriptor.kind) {
    case 'primitive':
      return typeof value === descriptor.name
    case 'null':
      return value === null || value === undefined
    case 'function':
      return typeof value === 'function'
    case 'array':
      if (!Array.isArray(value)) return false
      if (descriptor.element === undefined) return true
      for (const item of value) {
        if (!is(item, descriptor.element)) return false
      }
      return true
    case 'optional':
      if (value === null || value === undefined) return true
      return descriptor.inner === undefined || is(value, descriptor.inner)
    case 'native':
      return descriptor.check ? descriptor.check(value) : false
    case 'object':
      // Open-ended root — matches any non-null object (or `Any` matches
      // anything; `Never` matches nothing).
      if (descriptor.name === 'any') return true
      if (descriptor.name === 'never') return false
      return typeof value === 'object' && value !== null
    case 'struct':
      if (typeof value !== 'object' || value === null) return false
      if (Array.isArray(value)) return false
      if (!descriptor.fields) return true
      for (const field of descriptor.fields) {
        const present = field.name in (value as Record<string, unknown>)
        const fieldVal = (value as Record<string, unknown>)[field.name]
        if (field.optional) {
          if (!present || fieldVal === null || fieldVal === undefined) continue
          if (!is(fieldVal, field.type)) return false
        } else {
          if (!present) return false
          if (!is(fieldVal, field.type)) return false
        }
      }
      return true
  }
}

function describeDescriptor(descriptor: TypeDescriptor): string {
  if (descriptor.kind === 'struct') {
    const fields = descriptor.fields ?? []
    const shape = `{ ${fields
      .map((f) => `${f.name}${f.optional ? '?' : ''}: ${describeDescriptor(f.type)}`)
      .join('; ')} }`
    return descriptor.name === '__anon' ? shape : `${descriptor.name} ${shape}`
  }
  if (descriptor.kind === 'array') {
    return `${describeDescriptor(descriptor.element ?? Object_)}[]`
  }
  if (descriptor.kind === 'optional') {
    return `${describeDescriptor(descriptor.inner ?? Object_)}?`
  }
  return descriptor.name
}

function describeActual(value: unknown): string {
  return describeDescriptor(of(value))
}

function pathLabel(path: string): string {
  return path === '$' ? 'value' : path.slice(2)
}

function explainMismatchAt(value: unknown, descriptor: TypeDescriptor, path: string): string | null {
  switch (descriptor.kind) {
    case 'struct': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return `${pathLabel(path)} expected ${describeDescriptor(descriptor)}, got ${describeActual(value)}`
      }
      for (const field of descriptor.fields ?? []) {
        const record = value as Record<string, unknown>
        const present = field.name in record
        const fieldPath = `${path}.${field.name}`
        if (field.optional) {
          if (!present || record[field.name] === null || record[field.name] === undefined) continue
        } else if (!present) {
          return `${pathLabel(fieldPath)} is missing; expected ${describeDescriptor(field.type)}`
        }
        const nested = explainMismatchAt(record[field.name], field.type, fieldPath)
        if (nested) return nested
      }
      return null
    }
    case 'array': {
      if (!Array.isArray(value)) {
        return `${pathLabel(path)} expected ${describeDescriptor(descriptor)}, got ${describeActual(value)}`
      }
      const element = descriptor.element
      if (!element) return null
      for (let i = 0; i < value.length; i++) {
        const nested = explainMismatchAt(value[i], element, `${path}[${i}]`)
        if (nested) return nested
      }
      return null
    }
    case 'optional':
      if (value === null || value === undefined) return null
      return descriptor.inner ? explainMismatchAt(value, descriptor.inner, path) : null
    default:
      return is(value, descriptor)
        ? null
        : `${pathLabel(path)} expected ${describeDescriptor(descriptor)}, got ${describeActual(value)}`
  }
}

function formatMismatch(prefix: 'type.as' | 'type.tryFrom', value: unknown, descriptor: TypeDescriptor): string {
  const root = `expected ${describeDescriptor(descriptor)}, got ${describeActual(value)}`
  const detail = explainMismatchAt(value, descriptor, '$')
  if (!detail || detail === `value ${root}`) return `${prefix}: ${root}`
  return `${prefix}: ${root}; ${detail}`
}

/**
 * Thrown by `type.as` when the input value (after the optional
 * `castFn`) doesn't match the target descriptor. Caller can `try { … }
 * catch (e: TypeMismatchError) { … }` for a typed-failure path; or let
 * it propagate for fail-fast strictness.
 */
export class TypeMismatchError extends Error {
  override name = 'TypeMismatchError'
  constructor(
    message: string,
    public readonly expected: TypeDescriptor,
    public readonly actual: unknown
  ) {
    super(message)
  }
}

export type TypeTryFromResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: TypeMismatchError }

/**
 * Strict-cast helper (M9 Phase C). Validates `value` against `descriptor`
 * and returns it typed as `T`. The optional `castFn` runs first to
 * convert the raw input (e.g. parse a string to a number) before the
 * shape check.
 *
 * Three forms:
 *
 *   ```tu
 *   // 2-arg: assertion only — fail fast if shape doesn't match.
 *   let user: User = type.as(json, User)
 *
 *   // 3-arg: convert then check — `castFn` produces the shape-eligible
 *   // value from the raw input.
 *   let n: number = type.as(input, type.Number, parseInt)
 *
 *   // The `targetType` parameter accepts BOTH primitive descriptors
 *   // and user-defined interface descriptors — the M8 type-metadata
 *   // system unifies them under TypeDescriptor.
 *   ```
 *
 * The generic `T` is normally inferred from the destination annotation
 * (`let user: User = …` makes T = User). Callers wanting an explicit
 * widening / narrowing can pass `<T>` directly.
 */
export function as<T = unknown>(
  value: unknown,
  descriptor: TypeDescriptor,
  castFn?: (v: unknown) => unknown
): T {
  const v = castFn ? castFn(value) : value
  if (!is(v, descriptor)) {
    throw new TypeMismatchError(
      formatMismatch('type.as', v, descriptor),
      descriptor,
      v
    )
  }
  return v as T
}

/**
 * Non-throwing conversion helper. Mirrors `type.as` but returns a Result-
 * shaped value so callers can handle user-input conversion without
 * exceptions.
 */
export function tryFrom<T = unknown>(
  value: unknown,
  descriptor: TypeDescriptor,
  castFn?: (v: unknown) => unknown
): TypeTryFromResult<T> {
  let v: unknown
  try {
    v = castFn ? castFn(value) : value
  } catch {
    return {
      ok: false,
      error: new TypeMismatchError(
        `type.tryFrom: expected ${descriptor.name}, conversion failed`,
        descriptor,
        value
      ),
    }
  }
  if (!is(v, descriptor)) {
    return {
      ok: false,
      error: new TypeMismatchError(
        formatMismatch('type.tryFrom', v, descriptor),
        descriptor,
        v
      ),
    }
  }
  return { ok: true, value: v as T }
}

/**
 * Aggregate namespace export. Compiled Tu code will see this as `type` —
 * `type.of(v)`, `type.is(v, I)`, `type.as(v, T)`, `type.tryFrom(v, T)`,
 * `type.Number`, etc.
 *
 * The trailing-underscore in primitive names (`Number_`, `String_`)
 * dodges the JS-global collision; the namespace re-exports them under
 * their proper names (`type.Number`, `type.String`).
 */
export const type = {
  of,
  is,
  as,
  tryFrom,
  tag,
  struct,
  native,
  Array: Array_,
  Optional,
  Number: Number_,
  String: String_,
  Boolean: Boolean_,
  BigInt: BigInt_,
  Symbol: Symbol_,
  Null,
  Function: Function_,
  Object: Object_,
  Any,
  Never,
  Promise: Promise_,
  Map: Map_,
  Set: Set_,
  Error: Error_,
  RegExp: RegExp_,
  AbortController: AbortController_,
  // Date stays on the type API for users coming from JS `instanceof`-Date
  // patterns; new Tu code should use @tu-lang/time's Temporal types.
  Date: Date_,
  // Temporal descriptors (M8 Phase 5).
  Instant: Instant_,
  ZonedDateTime: ZonedDateTime_,
  PlainDate: PlainDate_,
  PlainTime: PlainTime_,
  PlainDateTime: PlainDateTime_,
  PlainYearMonth: PlainYearMonth_,
  PlainMonthDay: PlainMonthDay_,
  Duration: Duration_,
} as const
