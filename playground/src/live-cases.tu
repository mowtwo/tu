// Live editor case library — each case is a self-contained .tu
// workspace that exercises a different slice of Tu's surface area.
// The live demo loads one at a time; the user picks via the sidebar
// dropdown.
//
// Shape:
//   { id, label, blurb, entry, files: [{ path, content }] }
//
// Each case's `entry` file must `export let App = () => …`.

let counterCase = () => ({
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

let compositionCase = () => ({
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
  Card("Cells") {
    p { "Tu auto-wraps top-level let into reactive cells." }
  }
  Card("Components") {
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
      content: `export let Card = (title: string, children: Child[]) => .card() {
  h3 { title }
  .body() { children }

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

let todoCase = () => ({
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

let asyncFetchCase = () => ({
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

let formCase = () => ({
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
    div(class: "field") {
      label { "Name" }
      input(value: name, onInput: onName, placeholder: "Your name")
      if (nameError.length > 0) { span(class: "err") { nameError } }
    }
    div(class: "field") {
      label { "Email" }
      input(value: email, onInput: onEmail, placeholder: "you@example.com")
      if (emailError.length > 0) { span(class: "err") { emailError } }
    }
    button(class: "btn", onClick: onSubmit, disabled: !canSubmit) { "Submit" }
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

// Lambda-factory export — Tu cell-wraps non-lambda module values, so a
// namespace-imported `m.CASES` would otherwise be a Signal.State
// instance instead of the array.
export let CASES = () => [
  counterCase(),
  compositionCase(),
  todoCase(),
  asyncFetchCase(),
  formCase(),
]
