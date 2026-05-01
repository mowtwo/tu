// tu-xing Button — primary / secondary / ghost / danger variants × sm / md / lg sizes.
//
// Usage (M6.1 named-arg form recommended):
//   import { Button } from "@tu-lang/tu-xing"
//   Button(variant: "primary", size: "md", onClick: handler) { "Click me" }
//
// Variant CSS uses the theme tokens declared in theme.css — no Tailwind
// dependency for the component itself, though consumers can pass
// additional Tailwind utilities via the `class` prop (merged at the end).

let variantClass = (v) =>
  if (v == "secondary") {
    "bg-[hsl(var(--tu-surface-elevated))] text-[hsl(var(--tu-fg))] border border-[hsl(var(--tu-border))] hover:bg-[hsl(var(--tu-border))]"
  }
  else if (v == "ghost") {
    "bg-transparent text-[hsl(var(--tu-fg))] hover:bg-[hsl(var(--tu-surface-elevated))]"
  }
  else if (v == "danger") {
    "bg-[hsl(var(--tu-danger))] text-white hover:opacity-90"
  }
  else {
    "bg-[hsl(var(--tu-brand))] text-[hsl(var(--tu-brand-fg))] hover:bg-[hsl(var(--tu-brand-hover))]"
  }

let sizeClass = (s) =>
  if (s == "sm") { "px-3 py-1.5 text-sm rounded-[var(--tu-radius-sm)]" }
  else if (s == "lg") { "px-6 py-3 text-base rounded-[var(--tu-radius-lg)]" }
  else { "px-4 py-2 text-sm rounded-[var(--tu-radius)]" }

export let Button = (props) => button(
  type: "button",
  class: "inline-flex items-center justify-center gap-2 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--tu-brand))] " + variantClass(props.variant) + " " + sizeClass(props.size),
  onClick: props.onClick,
  disabled: props.disabled,
) { props.children }
