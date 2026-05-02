// tu-xing Tabs — list of tab labels driving an `active` cell. Render
// the matching content yourself based on `active.get()`.
//
// Usage:
//   let active = "overview"
//   Tabs(items: ["overview", "settings", "billing"], active: active, onSelect: (id) => active = id)
//   if (active == "overview") { div { "..." } }

export interface TabsProps {
  items?: string[]
  active?: string
  onSelect?: (id: string) => void
}

let tabClass = (id: string, active: string): string =>
  if (id == active) {
    "px-4 py-2 text-sm font-medium border-b-2 border-[hsl(var(--tu-brand))] text-[hsl(var(--tu-brand))]"
  } else {
    "px-4 py-2 text-sm font-medium border-b-2 border-transparent text-[hsl(var(--tu-fg-muted))] hover:text-[hsl(var(--tu-fg))]"
  }

export let Tabs = (props: TabsProps) => div(
  role: "tablist",
  class: "flex border-b border-[hsl(var(--tu-border))]",
) {
  for id in props.items {
    button(
      type: "button",
      role: "tab",
      class: tabClass(id, props.active),
      onClick: () => props.onSelect(id),
    ) { id }
  }
}
