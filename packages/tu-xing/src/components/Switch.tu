// tu-xing Switch — toggle. `checked` is a boolean prop (often a state
// cell read in the consumer); `onChange` receives the new value.
//
// Usage: Switch(checked: enabled, onChange: (v) => enabled = v)

export interface SwitchProps {
  checked?: boolean
  onChange?: (next: boolean) => void
}

let trackClass = (on: boolean): string =>
  if (on) { "bg-[hsl(var(--tu-brand))]" }
  else { "bg-[hsl(var(--tu-border))]" }

let thumbClass = (on: boolean): string =>
  if (on) { "translate-x-5" }
  else { "translate-x-0.5" }

export let Switch = (props: SwitchProps) => button(
  type: "button",
  role: "switch",
  class: "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--tu-brand))] " + trackClass(props.checked),
  onClick: () => props.onChange(props.checked == false),
) {
  span(
    class: "inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform " + thumbClass(props.checked),
  )
}
