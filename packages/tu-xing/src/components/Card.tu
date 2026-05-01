// tu-xing Card — surface container with header / content / footer slots.
//
// Slot pattern: pass each slot as a vnode (or function-valued prop, but
// V1 uses vnode form for simplicity). Skipped slots render as empty.
//
// Usage:
//   Card(
//     title: "Settings",
//     description: "Manage your account",
//     footer: Button(variant: "primary") { "Save" },
//   ) {
//     p { "Form fields go here" }
//   }

export type CardProps = {
  title?: string
  description?: string
  footer?: () => Child
  children?: Child[]
}

let renderHeader = (props: CardProps) =>
  if (props.title) {
    div(class: "px-6 pt-6 pb-3") {
      h3(class: "text-lg font-semibold text-[hsl(var(--tu-fg))]") { props.title }
      if (props.description) {
        p(class: "mt-1 text-sm text-[hsl(var(--tu-fg-muted))]") { props.description }
      }
    }
  } else { "" }

let renderFooter = (props: CardProps) =>
  if (props.footer) {
    div(class: "px-6 py-4 border-t border-[hsl(var(--tu-border))] bg-[hsl(var(--tu-surface))]/50") {
      props.footer()
    }
  } else { "" }

export let Card = (props: CardProps) => div(
  class: "rounded-[var(--tu-radius-lg)] border border-[hsl(var(--tu-border))] bg-[hsl(var(--tu-surface))] shadow-[var(--tu-shadow)] overflow-hidden",
) {
  renderHeader(props)
  div(class: "px-6 py-4") {
    props.children
  }
  renderFooter(props)
}
