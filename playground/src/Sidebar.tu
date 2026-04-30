// Tu-rendered playground sidebar (M5+ dogfood).
//
// What it exercises:
//   • Array literal of object literals — each demo is `{ id, label, blurb }`.
//   • `for d in demos` over a static array; member access (`d.id`,
//     `d.label`) reads each entry's fields.
//   • Reactive `class:` binding driven by the exported `activeId` cell:
//     mutating `activeId.set(...)` from JS triggers the keyed diff and the
//     `is-active` highlight follows without a manual rerender.
//   • Cross-`.tu` imports are unused here — the demos data lives inline so
//     the playground builds without touching example files.

export let activeId = "hello"

let demos = [
  { id: "hello",       label: "M1.0  Hello" },
  { id: "counter",     label: "M1.2  Counter" },
  { id: "todo",        label: "M1.3  Todo" },
  { id: "card",        label: "M1.4  Card" },
  { id: "clicker",     label: "M1.5  Clicker" },
  { id: "scoped",      label: "M1.8  Scoped" },
  { id: "composition", label: "M5    Composition" },
  { id: "typed",       label: "M5.6/7/8  Typed" },
  { id: "diff",        label: "M1.7  Diff" },
]

let DemoLink = (id: string, label: string) => a(
  href: "#" + id,
  class: if (activeId == id) { "is-active" } else { "" },
) { label }

export let Sidebar = () => aside(class: "sidebar") {
  h1(class: "brand") { "Tu " span(class: "brand__cn") { "图" } }
  p(class: "subtitle") { "Pre-alpha playground" }
  nav(class: "demos") {
    for d in demos {
      DemoLink(d.id, d.label)
    }
  }
  footer(class: "meta") {
    p {
      "Edit any " code { ".tu" } " file under " code { "examples/" }
      " and the page reloads via the " code { "@tu/vite" } " plugin."
    }
  }
}
