// Tu-rendered playground sidebar — uses @tu-lang/tu-xing Badge plus
// Tu's array literal / object literal / member access / for-loop /
// reactive class binding. Dogfoods cross-package import:
// `@tu-lang/tu-xing/Badge.tu` is an actual npm-published .tu source.

import { Badge } from "@tu-lang/tu-xing/Badge.tu"

export let activeId = "hello"

let demos = [
  { id: "hello",       label: "Hello",       mil: "M1.0" },
  { id: "counter",     label: "Counter",     mil: "M1.2" },
  { id: "todo",        label: "Todo",        mil: "M1.3" },
  { id: "card",        label: "Card",        mil: "M1.4" },
  { id: "clicker",     label: "Clicker",     mil: "M1.5" },
  { id: "scoped",      label: "Scoped",      mil: "M1.8" },
  { id: "composition", label: "Composition", mil: "M5" },
  { id: "typed",       label: "Typed",       mil: "M5.6/7/8" },
  { id: "tu-xing",     label: "tu-xing UI",  mil: "图形" },
  { id: "tailwind",    label: "Tailwind",    mil: "M6.3" },
  { id: "diff",        label: "Diff",        mil: "M1.7" },
]

let linkClass = (id) =>
  if (activeId == id) {
    "block px-3 py-1.5 rounded-[var(--tu-radius-sm)] bg-[hsl(var(--tu-brand))]/15 text-[hsl(var(--tu-brand))] no-underline transition-colors"
  } else {
    "block px-3 py-1.5 rounded-[var(--tu-radius-sm)] text-[hsl(var(--tu-fg-muted))] hover:bg-[hsl(var(--tu-surface-elevated))] hover:text-[hsl(var(--tu-fg))] no-underline transition-colors"
  }

let DemoLink = (props) => a(
  href: "#" + props.id,
  class: linkClass(props.id),
) {
  div(class: "flex items-center justify-between gap-2") {
    span { props.label }
    Badge(variant: "outline") { props.mil }
  }
}

export let Sidebar = () => aside(
  class: "p-6 border-r border-[hsl(var(--tu-border))] bg-[hsl(var(--tu-surface))] flex flex-col gap-4 min-h-screen",
) {
  div {
    h1(class: "text-2xl font-semibold tracking-tight m-0 text-[hsl(var(--tu-fg))]") {
      "Tu " span(class: "text-[hsl(var(--tu-fg-muted))] font-normal") { "图" }
    }
    p(class: "mt-1 text-xs uppercase tracking-wider text-[hsl(var(--tu-fg-muted))]") {
      "Pre-alpha · 0.1.0-alpha.6"
    }
  }
  nav(class: "flex flex-col gap-1") {
    for d in demos {
      DemoLink(id: d.id, label: d.label, mil: d.mil)
    }
  }
  footer(class: "mt-auto pt-4 border-t border-[hsl(var(--tu-border))] text-xs text-[hsl(var(--tu-fg-muted))]") {
    p {
      "Edit " code(class: "font-mono text-[hsl(var(--tu-fg))]") { ".tu" }
      " files in " code(class: "font-mono text-[hsl(var(--tu-fg))]") { "examples/" }
      " — page reloads via " code(class: "font-mono text-[hsl(var(--tu-fg))]") { "@tu-lang/vite" }
      "."
    }
  }
}
