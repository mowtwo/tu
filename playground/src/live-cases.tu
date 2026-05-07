// Live editor case library — each case is a self-contained .tu
// workspace that exercises a different slice of Tu's surface area.
// The live demo loads one at a time; the user picks via the sidebar
// dropdown.
//
// Each case's `entry` file must `export let App = () => …`.

export interface CaseFile { path: string; content: string }
export interface CaseDefinition {
  id: string
  label: string
  blurb: string
  entry: string
  files: CaseFile[]
}

let counterCase = (): CaseDefinition => ({
  id: "counter",
  label: "Counter",
  blurb: "Single-file reactive cell + scoped style. The simplest case.",
  entry: "App.tu",
  files: [
    {
      path: "App.tu",
      content: `let count = 0
let inc = () => count = count + 1
let dec = () => count = count - 1

export let App = () => div(class: "counter") {
  p(class: "label") { "count = " count }
  div(class: "row") {
    button(onClick: dec) { "−" }
    button(onClick: inc) { "+" }
  }

  style {
    .counter {
      padding: 1.5rem;
      max-width: 24rem;
      background: hsl(var(--tu-surface-elevated));
      border-radius: 8px;
      font-family: system-ui, sans-serif;
    }
    .label { font-size: 1.5rem; margin: 0 0 1rem; }
    .row { display: flex; gap: 0.5rem; }
    .row > button {
      flex: 1;
      padding: 0.5rem;
      font-size: 1.25rem;
      background: hsl(var(--tu-brand));
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
  }
}
`,
    },
  ],
})

let compositionCase = (): CaseDefinition => ({
  id: "composition",
  label: "Composition (multi-file)",
  blurb: "Two .tu files importing each other — Card component reused twice in App. Validates cross-file Tu imports.",
  entry: "App.tu",
  files: [
    {
      path: "App.tu",
      content: `import { Card } from "./Card.tu"

export let App = () => div(class: "stack") {
  h1 { "Composition demo" }
  Card(title: "Cells") {
    p { "Tu auto-wraps top-level let into reactive cells." }
  }
  Card(title: "Components") {
    p { "Capitalized lambdas compile to real function calls — hover and goto-def work across files." }
  }

  style {
    .stack {
      max-width: 32rem;
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
      font-family: system-ui, sans-serif;
    }
    .stack > h1 { margin: 0; font-size: 1.5rem; }
  }
}
`,
    },
    {
      path: "Card.tu",
      content: `interface CardProps { title?: string; children?: Child[] }
export let Card = (props: CardProps) => .card() {
  h3 { props.title }
  .body() { props.children }

  style {
    .card {
      border: 1px solid hsl(var(--tu-border));
      background: hsl(var(--tu-surface));
      border-radius: 8px;
      overflow: hidden;
    }
    .card > h3 {
      margin: 0;
      padding: 0.75rem 1rem;
      background: hsl(var(--tu-surface-elevated));
      font-size: 1rem;
    }
    .body { padding: 1rem; }
    .body > p { margin: 0; line-height: 1.5; }
  }
}
`,
    },
  ],
})

let todoCase = (): CaseDefinition => ({
  id: "todo",
  label: "Todo (control flow)",
  blurb: "Reactive list with for-loop, computed cells, if/else if/else. Validates Tu's expression-shaped control flow.",
  entry: "App.tu",
  files: [
    {
      path: "App.tu",
      content: `let items = ["buy milk", "walk the dog"]
let draft = ""

let label = computed(
  if (items.length == 0) { "no tasks" }
  else if (items.length == 1) { "1 task" }
  else { items.length + " tasks" }
)

let onInput = (e: Event) => draft = e.target.value
let onAdd = () => {
  if (draft.length > 0) {
    items = [...items.get(), draft.get()]
    draft = ""
  }
}
let onClear = () => items = []

export let App = () => div(class: "todo") {
  h1 { "Todo — " label }
  div(class: "form") {
    input(value: draft, onInput: onInput, placeholder: "What's next?")
    button(onClick: onAdd) { "add" }
    button(onClick: onClear) { "clear" }
  }
  if (items.length == 0) {
    p(class: "empty") { "Nothing to do — type something above." }
  } else {
    ul(class: "list") {
      for item in items {
        li { item }
      }
    }
  }

  style {
    .todo {
      max-width: 28rem;
      padding: 1.5rem;
      font-family: system-ui, sans-serif;
    }
    .todo > h1 { margin: 0 0 1rem; font-size: 1.25rem; }
    .form { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
    .form > input {
      flex: 1;
      padding: 0.5rem;
      border: 1px solid hsl(var(--tu-border));
      border-radius: 4px;
      background: hsl(var(--tu-surface));
      color: hsl(var(--tu-fg));
    }
    .form > button {
      padding: 0.5rem 1rem;
      background: hsl(var(--tu-brand));
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    .empty { color: hsl(var(--tu-fg-muted)); margin: 0; }
    .list { margin: 0; padding-left: 1.25rem; }
    .list > li { padding: 0.25rem 0; }
  }
}
`,
    },
  ],
})

let asyncFetchCase = (): CaseDefinition => ({
  id: "async-fetch",
  label: "Async fetch (try/catch)",
  blurb: "Async lambda + try/catch + dynamic state machine (loading / error / success). Validates Tu's async surface.",
  entry: "App.tu",
  files: [
    {
      path: "App.tu",
      content: `import { jokeApi } from "./api.tu"

let status = "idle"
let joke = ""
let error = ""

let load = async () => {
  status = "loading"
  error = ""
  try {
    let result = await jokeApi()
    joke = result
    status = "ok"
  } catch (e: unknown) {
    error = e?.message ?? String(e)
    status = "error"
  }
}

export let App = () => div(class: "fetch-demo") {
  h1 { "Async fetch demo" }
  p(class: "blurb") { "Click to fetch a random programming joke." }
  button(class: "btn", onClick: load) {
    if (status == "loading") { "Loading..." } else { "Fetch a joke" }
  }
  if (status == "ok") {
    blockquote(class: "joke") { joke }
  }
  if (status == "error") {
    p(class: "error") { "Failed: " error }
  }

  style {
    .fetch-demo {
      max-width: 32rem;
      padding: 1.5rem;
      font-family: system-ui, sans-serif;
    }
    .fetch-demo > h1 { margin: 0 0 0.25rem; font-size: 1.25rem; }
    .blurb { margin: 0 0 1rem; color: hsl(var(--tu-fg-muted)); font-size: 0.9rem; }
    .btn {
      padding: 0.5rem 1rem;
      background: hsl(var(--tu-brand));
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.95rem;
    }
    .joke {
      margin: 1rem 0 0;
      padding: 1rem;
      background: hsl(var(--tu-surface-elevated));
      border-left: 3px solid hsl(var(--tu-brand));
      font-style: italic;
    }
    .error {
      margin-top: 1rem;
      color: hsl(var(--tu-danger));
      font-size: 0.9rem;
    }
  }
}
`,
    },
    {
      path: "api.tu",
      content: `// Simple wrapper around a public joke API. Returns the joke string;
// throws on HTTP failure. Demonstrates async / await / fetch / JSON.

export let jokeApi = async (): Promise<string> => {
  let r = await fetch("https://icanhazdadjoke.com/", {
    headers: { "Accept": "application/json" },
  })
  if (!r.ok) {
    throw new Error("HTTP " + r.status)
  }
  let body = await r.json()
  return body.joke ?? "(no joke field in response)"
}
`,
    },
  ],
})

let formCase = (): CaseDefinition => ({
  id: "form",
  label: "Form binding",
  blurb: "Two-way input binding via cells, derived validation, computed enable/disable. Validates Tu's reactive bindings.",
  entry: "App.tu",
  files: [
    {
      path: "App.tu",
      content: `let name = ""
let email = ""
let submitted = false

let nameError = computed(if (name.length == 0) { "" } else if (name.length < 2) { "Too short" } else { "" })
let emailError = computed(if (email.length == 0) { "" } else if (!email.includes("@")) { "Need an @" } else { "" })
let canSubmit = computed(name.length >= 2 && email.includes("@"))

let onName = (e: Event) => name = e.target.value
let onEmail = (e: Event) => email = e.target.value
let onSubmit = () => submitted = true
let onReset = () => {
  name = ""
  email = ""
  submitted = false
}

export let App = () => div(class: "form") {
  h1 { "Form demo" }
  if (submitted) {
    div(class: "success") {
      p { "Thanks, " name "!" }
      p(class: "muted") { "Confirmation sent to " email "." }
      button(class: "btn", onClick: onReset) { "Reset" }
    }
  } else {
    // Multiple sibling vnodes — wrap in an array literal to make the
    // fragment intent explicit. Tu's runtime flattens nested arrays
    // in children automatically, so [vnode, vnode, ...] renders the
    // same as if you'd authored siblings directly.
    [
      div(class: "field") {
        label { "Name" }
        input(value: name, onInput: onName, placeholder: "Your name")
        if (nameError.length > 0) { span(class: "err") { nameError } }
      },
      div(class: "field") {
        label { "Email" }
        input(value: email, onInput: onEmail, placeholder: "you@example.com")
        if (emailError.length > 0) { span(class: "err") { emailError } }
      },
      button(class: "btn", onClick: onSubmit, disabled: !canSubmit) { "Submit" }
    ]
  }

  style {
    .form {
      max-width: 24rem;
      padding: 1.5rem;
      font-family: system-ui, sans-serif;
    }
    .form > h1 { margin: 0 0 1rem; font-size: 1.25rem; }
    .field {
      margin-bottom: 0.75rem;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .field > label { font-size: 0.85rem; color: hsl(var(--tu-fg-muted)); }
    .field > input {
      padding: 0.5rem;
      border: 1px solid hsl(var(--tu-border));
      border-radius: 4px;
      background: hsl(var(--tu-surface));
      color: hsl(var(--tu-fg));
    }
    .err { color: hsl(var(--tu-danger)); font-size: 0.8rem; }
    .btn {
      padding: 0.5rem 1rem;
      background: hsl(var(--tu-brand));
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    .btn:disabled {
      background: hsl(var(--tu-fg-muted));
      cursor: not-allowed;
    }
    .success { display: flex; flex-direction: column; gap: 0.5rem; }
    .success > p { margin: 0; }
    .muted { color: hsl(var(--tu-fg-muted)); font-size: 0.9rem; }
  }
}
`,
    },
  ],
})

let jsCompatCase = (): CaseDefinition => ({
  id: "js-compat",
  label: "JS/TS surface (compat)",
  blurb: "How far Tu reaches into modern JS/TS — spread, optional chaining + ??, if expressions, regex literal, compound assignment, try/catch/finally, async/await, external JS escape hatch. Click the JS tab on the right to see the emitted code.",
  entry: "App.tu",
  files: [
    {
      path: "App.tu",
      content: `// Showcase: every modern JS/TS feature Tu compiles to native form.

interface Todo { id: number; title: string; done: boolean }

let todos: Todo[] = [
  { id: 1, title: "Read M5.10 release notes", done: true },
  { id: 2, title: "Try optional chaining", done: false },
  { id: 3, title: "Verify regex literal works", done: false },
]
let nextId = 4
let lastError = ""

// Regex literal — used inline + via a method call.
let slugOk = (s: string): boolean => /^[a-z][a-z0-9-]*$/.test(s)

// Optional chaining + nullish coalescing.
interface User { name: string; email: string | null }
let formatUser = (u: User | null): string => {
  let name = u?.name ?? "anonymous"
  let email = u?.email ?? "no-email"
  return name + " <" + email + ">"
}

// Counts via a manual loop and explicit local assignment.
let openCount = (xs: Todo[]): number => {
  let n = 0
  for t in xs {
    if (!t.done) { n = n + 1 }
  }
  return n
}

// Object spread for immutable toggle, plus an if expression inside .map.
let onToggle = (id: number) => {
  todos = todos.map((t: Todo) => if (t.id == id) { { ...t, done: !t.done } } else { t })
}

// Array spread + compound assignment on a top-level cell.
let onAdd = () => {
  let id = nextId.get()
  todos = [...todos.get(), { id: id, title: "Item #" + id, done: false }]
  nextId += 1
}

let onClear = () => {
  todos = []
}

// async / try / catch / finally with throw.
let fakeFetch = async (id: number): Promise<User> => {
  await new Promise((r: () => void) => setTimeout(r, 200))
  if (id < 0) {
    throw new Error("bad id: " + id)
  }
  return { name: "User #" + id, email: "user" + id + "@example.com" }
}

let profile: User | null = null
let loading = false
let onLoad = async (id: number) => {
  loading = true
  lastError = ""
  try {
    let u = await fakeFetch(id)
    profile = u
  } catch (e: unknown) {
    lastError = e?.message ?? String(e)
    profile = null
  } finally {
    loading = false
  }
}

// External JS escape hatch — pure JS for a tight imperative loop +
// performance.now(). Tu auto-injects nothing here; the body is pasted
// verbatim into the emitted JS and called as a normal function.
interface ShuffleResult { ms: number; out: number[] }
let shuffleAndTime = external JS (xs: number[]): ShuffleResult {
  const out = xs.slice()
  const t0 = performance.now()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = out[i]; out[i] = out[j]; out[j] = tmp
  }
  return { ms: performance.now() - t0, out }
}
let shuffleResult = shuffleAndTime([1, 2, 3, 4, 5, 6, 7, 8])

export let App = () => div(class: "panel") {
  h2 { "JS/TS surface — what compiles to native JS" }
  p(class: "blurb") {
    "Every block below exercises a different modern JS/TS feature."
  }

  div(class: "row") {
    button(class: "btn", onClick: onAdd) { "+ add" }
    button(class: "btn", onClick: onClear) { "clear" }
    " "
    span(class: "muted") { openCount(todos) " open of " todos.length }
  }

  ul(class: "todos") {
    for t in todos {
      li(class: if (t.done) { "done" } else { "open" }, onClick: () => onToggle(t.id)) {
        span(class: "id") { "#" t.id }
        " "
        span(class: "title") { t.title }
        " "
        span(class: "tag") { if (t.done) { "done ✔" } else { "open" } }
      }
    }
  }

  h3 { "Async + try/catch/finally" }
  div(class: "row") {
    button(class: "btn", onClick: () => onLoad(7)) {
      if (loading) { "Loading…" } else { "Fetch user 7" }
    }
    button(class: "btn", onClick: () => onLoad(-1)) { "Fetch bad id (will throw)" }
  }
  if (profile != null) {
    p(class: "ok") { "Loaded: " formatUser(profile) }
  }
  if (lastError.length > 0) {
    p(class: "err") { "Caught: " lastError }
  }

  h3 { "Regex literal + slug check" }
  ul(class: "slugs") {
    li { if (/^[a-z][a-z0-9-]*$/.test("hello")) { "✔ /^[a-z][a-z0-9-]*$/ matches \\"hello\\"" } else { "no" } }
    li { if (slugOk("Bad Slug")) { "yes" } else { "✘ slugOk(\\"Bad Slug\\")" } }
  }

  h3 { "Optional chain + ?? on null user" }
  p { "formatUser(null) = " formatUser(null) }

  h3 { "external JS escape hatch (Fisher–Yates)" }
  p(class: "muted") {
    "Shuffled [1..8] in " shuffleResult.ms.toFixed(2) "ms → "
    shuffleResult.out.join(", ")
  }

  style {
    .panel {
      max-width: 36rem;
      padding: 1.25rem 1.5rem;
      font-family: system-ui, sans-serif;
    }
    .panel > h2 { margin: 0 0 0.25rem; font-size: 1.15rem; }
    .panel > h3 {
      margin: 1rem 0 0.25rem;
      font-size: 0.95rem;
      color: hsl(var(--tu-brand));
    }
    .blurb { margin: 0 0 1rem; color: hsl(var(--tu-fg-muted)); font-size: 0.9rem; }
    .row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
      margin: 0.5rem 0;
    }
    .btn {
      padding: 0.4rem 0.85rem;
      background: hsl(var(--tu-brand));
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.9rem;
    }
    .btn:hover { filter: brightness(1.1); }
    .muted { color: hsl(var(--tu-fg-muted)); font-size: 0.85rem; }
    .todos, .slugs { margin: 0; padding-left: 1.25rem; }
    .todos > li { padding: 0.2rem 0; cursor: pointer; }
    .todos > li:hover { background: hsl(var(--tu-surface-elevated)); }
    .id { color: hsl(var(--tu-fg-muted)); font-variant-numeric: tabular-nums; }
    .tag { color: hsl(var(--tu-brand)); font-size: 0.8rem; }
    .done > .title { color: hsl(var(--tu-fg-muted)); text-decoration: line-through; }
    .ok { color: hsl(var(--tu-brand)); margin: 0.5rem 0 0; }
    .err { color: hsl(var(--tu-danger)); margin: 0.5rem 0 0; }
  }
}
`,
    },
  ],
})

// M8 + M9 — interface, type.of, type.is, type.as, Exception, throws clause.
// Showcases the type-metadata system end-to-end: interfaces double as
// runtime descriptors; type.as validates untrusted JSON input; Exception
// carries fields + stack trace; throws clauses make functions explicit
// about their failure modes.
let typesCase = (): CaseDefinition => ({
  id: "types",
  label: "Types + Exceptions",
  blurb: "interface as runtime descriptor, type.as for runtime cast, Exception for structured errors with stack trace + per-function throws clauses.",
  entry: "App.tu",
  files: [
    {
      path: "App.tu",
      content: `// M8: interface declares both the TS type AND a runtime descriptor.
// M9 Exception: carries fields, stack trace, type.is participation.
interface User { id: number; name: string }
Exception ValidationError { field: string }

// type.as validates a raw object against the User shape — fails with
// TypeMismatchError if mismatched. Runtime cast that doubles as a
// type guard for tsserver via destination annotation.
let parseUser = (raw: unknown): User ? ValidationError => {
  if (type.is(raw, type.Object)) {
    return type.as(raw, User)
  }
  throw ValidationError("not a user shape", { field: "(root)" })
}

// Reactive cell — type.tag is auto-injected at the typed-let site so
// type.of(alice) === User (reference equality, not duck-typing).
let alice: User = { id: 1, name: "Alice" }

let raw = '{"id": 2, "name": "Bob"}'
let parsed = ""
let bob: User | null = null
let lastError = ""

let runParse = () => {
  lastError = ""
  bob = null
  try {
    let obj = JSON.parse(raw)
    let u = parseUser(obj)
    bob = u
    parsed = "parsed: " + u.name + " (id " + u.id + ")"
  } catch (e: ValidationError | unknown) {
    if (type.is(e, ValidationError)) {
      lastError = "ValidationError on field '" + (e?.field ?? "?") + "': " + (e?.message ?? "")
    } else {
      lastError = "Error: " + (e?.message ?? String(e))
    }
  }
}

export let App = () => div(class: "demo") {
  h1 { "Types + Exceptions" }
  p(class: "blurb") {
    "Edit the JSON below. Valid input parses through type.as(raw, User) and tags the result. Invalid input throws ValidationError or TypeMismatchError."
  }
  div(class: "row") {
    label { "raw JSON: " }
    input(value: raw, onInput: (e: Event) => raw = (() => {
      let t = e.target
      if (t != null && type.is(t, type.Object)) {
        return t.value ?? ""
      }
      return ""
    })())
    button(onClick: runParse) { "parse" }
  }
  div(class: "info") {
    p { "alice: type.of == User: " (type.of(alice) == User) }
  }
  if (parsed != "") { p(class: "ok") { parsed } }
  if (lastError != "") { p(class: "err") { lastError } }
  if (bob != null) {
    div(class: "card") {
      p { "bob.id = " bob.id }
      p { "bob.name = " bob.name }
      p { "type.is(bob, User) = " type.is(bob, User) }
    }
  }

  style {
    .demo { max-width: 32rem; padding: 1.5rem; font-family: system-ui, sans-serif; }
    .demo > h1 { margin: 0 0 0.5rem; font-size: 1.25rem; }
    .blurb { margin: 0 0 1rem; color: hsl(var(--tu-fg-muted)); font-size: 0.9rem; line-height: 1.5; }
    .row { display: flex; gap: 0.5rem; margin-bottom: 1rem; align-items: center; }
    .row > input {
      flex: 1;
      padding: 0.5rem;
      border: 1px solid hsl(var(--tu-border));
      border-radius: 4px;
      background: hsl(var(--tu-surface));
      color: hsl(var(--tu-fg));
      font-family: monospace;
      font-size: 0.85rem;
    }
    .row > button {
      padding: 0.5rem 1rem;
      background: hsl(var(--tu-brand));
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    .info {
      margin: 1rem 0;
      padding: 0.75rem;
      background: hsl(var(--tu-surface-elevated));
      border-radius: 4px;
      font-size: 0.85rem;
      font-family: monospace;
    }
    .ok { color: hsl(var(--tu-success, 142 71% 45%)); margin: 0.5rem 0; }
    .err { color: hsl(var(--tu-danger, 0 72% 50%)); margin: 0.5rem 0; }
    .card {
      margin-top: 1rem;
      padding: 1rem;
      background: hsl(var(--tu-surface-elevated));
      border-left: 3px solid hsl(var(--tu-brand));
      border-radius: 4px;
    }
    .card > p { margin: 0.25rem 0; font-size: 0.9rem; }
  }
}
`,
    },
  ],
})

// Lambda-factory export — Tu cell-wraps non-lambda module values, so a
// namespace-imported `m.CASES` would otherwise be a Signal.State
// instance instead of the array.
export let CASES = () => [
  counterCase(),
  compositionCase(),
  todoCase(),
  asyncFetchCase(),
  formCase(),
  jsCompatCase(),
  typesCase(),
]
