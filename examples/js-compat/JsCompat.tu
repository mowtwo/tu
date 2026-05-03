// M5.10–M6.x demo: how far Tu reaches into JS/TS surface syntax.
//
// Tu's compiler-to-JS aims to keep JavaScript/TypeScript ergonomics
// available without needing a runtime adapter — every JS feature listed
// here compiles to the corresponding native form, with `.get()` / `.set()`
// auto-injected only for top-level reactive cells.
//
// Features exercised in this single file:
//   • Type aliases — `type Todo = { … }` (TS-style).
//   • Object spread — `{ ...todo, done: true }`.
//   • Array spread + array methods — `[...todos, fresh]`, `.filter`, `.map`, `.find`.
//   • Template literals — `` `${name} has ${n} todos` ``.
//   • Optional chaining + nullish coalescing — `user?.name ?? "anon"`.
//   • Ternary — `n > 0 ? "some" : "none"`.
//   • Compound assignment + update — `total += 1`, `i++`.
//   • try / catch / finally + throw — recoverable errors.
//   • async / await + Promise — `await loadProfile()`.
//   • Regex literal — `/^[a-z]+$/i.test(slug)`.
//   • external JS escape hatch — drop into raw JS for one helper Tu can't
//     easily express (here: imperative `performance.now()` plus a tight
//     index-based array swap).

import { Fragment } from "@tu-lang/runtime"

// ── Types ───────────────────────────────────────────────────────────
interface Todo { id: number; title: string; done: boolean }
interface User { name: string; email: string | null }

// ── Reactive state ──────────────────────────────────────────────────
export let todos: Todo[] = [
  { id: 1, title: "Read M5.10 release notes", done: true },
  { id: 2, title: "Try template literals", done: false },
  { id: 3, title: "Verify regex literal works", done: false },
]
export let nextId = 4
export let log: string[] = []

// ── Pure helpers — exercise nearly every JS feature in one pass ─────

// Slug validation via regex literal. Tu lexes `/…/flags` outside an
// expression head exactly like JS.
let slugOk = (s: string): boolean => /^[a-z][a-z0-9-]*$/.test(s)

// Format a user using optional chaining + nullish coalescing.
// `user` may be `null`; `user.email` may be `null` even when `user` exists.
let formatUser = (user: User | null): string => {
  let name = user?.name ?? "anonymous"
  let email = user?.email ?? "no-email"
  return `${name} <${email}>`
}

// Toggle one todo immutably via object spread + array .map.
let toggle = (id: number): Todo[] => todos.map((t: Todo) => t.id == id
  ? { ...t, done: !t.done }
  : t
)

// Append via array spread + compound assignment on the cell.
// `nextId += 1` desugars to `nextId = nextId + 1`, and the surrounding
// AssignExpr handling rewrites top-level cells to `.set(.get() + 1)`.
let append = (title: string): Todo[] => {
  let id = nextId
  nextId += 1
  return [...todos.get(), { id, title, done: false }]
}

// Mark every todo done via .map; ternary just to show the operator.
let markAllDone = (): Todo[] => todos.map((t: Todo) => t.done ? t : { ...t, done: true })

// Counts via a manual loop + the postfix `++` operator on a plain local
// binding (Tu's update operators only legally apply to non-cell locals
// — top-level Signal cells use `+= 1` instead, see `append` above).
let countLabel = (xs: Todo[]): string => {
  let open = 0
  for t in xs {
    if (!t.done) { open++ }
  }
  let total = xs.length
  return open > 0 ? `${open} of ${total} open` : `all ${total} done`
}

// ── External JS escape hatch ────────────────────────────────────────
//
// Tu's `for x in xs` is array-yielding, so it can't reach into raw
// imperative timing + a hot index-swap loop. Drop into JS for the
// shuffle, return the array. The return type is an inline object
// shape — this used to require a type alias as a workaround, fixed
// in the M6.10.1 parser update.
let shuffleAndTime = external JS (xs: any[]): { ms: number; out: any[] } {
  const out = xs.slice()
  const t0 = performance.now()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = out[i]; out[i] = out[j]; out[j] = tmp
  }
  return { ms: performance.now() - t0, out }
}

// ── Async + try / catch / finally ───────────────────────────────────
//
// Pretend-fetch a profile. We simulate latency and conditional failure
// so the demo stays self-contained (no real network in `pnpm demo`).
let fakeFetchUser = async (id: number): Promise<User> => {
  await new Promise((resolve: () => void) => setTimeout(resolve, 0))
  if (id < 0) {
    throw new Error(`bad user id: ${id}`)
  }
  return id == 0
    ? { name: "Ada Lovelace", email: null }
    : { name: `User #${id}`, email: `user${id}@example.com` }
}

// loadProfile demonstrates try/catch/finally with an async lambda.
// Returns a tagged result so callers can render either path.
type LoadResult =
  | { tag: "ok"; user: User; took: string }
  | { tag: "err"; message: string }

export let loadProfile = async (id: number): Promise<LoadResult> => {
  let started = Date.now()
  try {
    let user = await fakeFetchUser(id)
    return { tag: "ok", user, took: `${Date.now() - started}ms` }
  } catch (e: unknown) {
    let message = e?.message ?? String(e)
    return { tag: "err", message }
  } finally {
    log = [...log.get(), `loadProfile(${id}) done`]
  }
}

// ── Public, plain-JS-callable API surface ───────────────────────────

// Drive the whole demo from one entry point — mirrors how a CLI/test
// would consume the compiled module. Exercising every feature once in
// a deterministic order keeps the run.mjs output meaningful.
export let runDemo = async (): Promise<{
  initial: string
  afterToggle: Todo[]
  afterAppend: Todo[]
  afterAllDone: Todo[]
  shuffleSummary: string
  slugChecks: string[]
  okProfile: LoadResult
  badProfile: LoadResult
  finalLog: string[]
}> => {
  let initial = countLabel(todos.get())

  // Object spread + array.map (immutable toggle).
  todos = toggle(2)
  let afterToggle = todos.get()

  // Array spread + ++.
  todos = append("Showcase external JS")
  let afterAppend = todos.get()

  // Map + ternary.
  todos = markAllDone()
  let afterAllDone = todos.get()

  // External JS bridge. The result is a plain JS object, so member
  // access (`.ms`, `.out`) goes through the auto-injected `.get()` only
  // if the binding itself were a cell — here `r` is a local `let`, so
  // it's a const in the compiled JS.
  let r = shuffleAndTime([1, 2, 3, 4, 5])
  let shuffleSummary = `shuffled ${r.out.length} in ${r.ms.toFixed(2)}ms → ${r.out.join(",")}`

  // Regex literal driving a list-comprehension via .map + ternary.
  let slugs = ["hello", "Bad Slug", "ok-123", "_no"]
  let slugChecks = slugs.map((s: string) => slugOk(s) ? `✔ ${s}` : `✘ ${s}`)

  // Async + try/catch/finally — happy path.
  let okProfile = await loadProfile(7)
  // Async + try/catch/finally — error path. Note `formatUser(null)`
  // exercises optional chaining on the null branch.
  let badProfile = await loadProfile(-1)
  log = [...log.get(), `formatted null user → ${formatUser(null)}`]

  return {
    initial,
    afterToggle,
    afterAppend,
    afterAllDone,
    shuffleSummary,
    slugChecks,
    okProfile,
    badProfile,
    finalLog: log.get(),
  }
}

// ── App view — same data rendered as a Tu component ─────────────────

let renderTodo = (t: Todo) => li(class: t.done ? "done" : "open") {
  span(class: "id") { `#${t.id}` }
  " "
  span(class: "title") { t.title }
  " "
  span(class: "tag") { t.done ? "done" : "open" }
}

export let App = () => Fragment {
  section(class: .panel) {
    h2 { "JS/TS surface — what compiles natively" }
    p(class: .summary) { countLabel(todos) }
    ul(class: .todos) {
      for t in todos {
        renderTodo(t)
      }
    }

    h3 { "Slug regex" }
    ul(class: .slugs) {
      // Each ternary + template literal renders inline.
      li { /^[a-z][a-z0-9-]*$/.test("hello") ? "/.../ matches `hello`" : "no" }
      li { /^[a-z][a-z0-9-]*$/.test("Bad Slug") ? "yes" : "/.../ rejects `Bad Slug`" }
    }

    h3 { "Optional chain + ?? on null user" }
    p { `formatUser(null) = ${formatUser(null)}` }
  }

  style {
    .panel { font-family: system-ui, sans-serif; padding: 1rem 1.25rem; max-width: 36rem; }
    .panel > h2 { font-size: 1.1rem; margin: 0 0 0.5rem; }
    .panel > h3 { font-size: 0.95rem; margin: 1rem 0 0.25rem; color: #4338ca; }
    .summary { margin: 0 0 0.75rem; color: #4b5563; font-size: 0.9rem; }
    .todos, .slugs { margin: 0; padding-left: 1.25rem; }
    .todos > li { padding: 0.15rem 0; }
    .id { color: #9ca3af; font-variant-numeric: tabular-nums; }
    .tag { color: #6366f1; font-size: 0.8rem; }
    .done > .title { color: #9ca3af; text-decoration: line-through; }
  }
}
