// tu-xing Dialog — modal overlay. Driven by a boolean `open` prop and
// an `onClose` callback. Click outside or press Escape to close
// (Escape key is the consumer's responsibility — wire a window
// keydown listener in JS land).
//
// Usage:
//   Dialog(open: dialogOpen, onClose: () => dialogOpen = false, title: "Confirm") {
//     p { "Are you sure?" }
//   }

export type DialogProps = {
  open?: boolean
  onClose?: () => void
  title?: string
  children?: Child[]
}

let renderTitle = (props: DialogProps) =>
  if (props.title) {
    div(class: "px-6 pt-6 pb-2") {
      h3(class: "text-lg font-semibold text-[hsl(var(--tu-fg))]") { props.title }
    }
  } else { "" }

export let Dialog = (props: DialogProps) =>
  if (props.open) {
    div(
      class: "fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm",
      onClick: props.onClose,
    ) {
      div(
        class: "relative w-full max-w-md rounded-[var(--tu-radius-lg)] border border-[hsl(var(--tu-border))] bg-[hsl(var(--tu-surface-elevated))] shadow-2xl",
        onClick: (e: Event) => e.stopPropagation(),
      ) {
        renderTitle(props)
        div(class: "px-6 py-4 text-[hsl(var(--tu-fg))]") {
          props.children
        }
      }
    }
  } else { "" }
