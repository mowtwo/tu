// tu-xing Input — text input with theme-aware borders and focus ring.
//
// Usage:
//   Input(type: "email", placeholder: "you@example.com", value: emailCell, onInput: setEmail)

export type InputSize = "sm" | "md" | "lg"

export type InputProps = {
  type?: string
  placeholder?: string
  value?: string
  size?: InputSize
  disabled?: boolean
  onInput?: (e: Event) => void
}

let sizeClass = (s: string): string =>
  if (s == "sm") { "px-2.5 py-1 text-sm rounded-[var(--tu-radius-sm)]" }
  else if (s == "lg") { "px-4 py-3 text-base rounded-[var(--tu-radius-lg)]" }
  else { "px-3 py-2 text-sm rounded-[var(--tu-radius)]" }

export let Input = (props: InputProps) => input(
  type: props.type,
  placeholder: props.placeholder,
  value: props.value,
  onInput: props.onInput,
  disabled: props.disabled,
  class: "w-full bg-[hsl(var(--tu-surface))] text-[hsl(var(--tu-fg))] border border-[hsl(var(--tu-border))] outline-none transition-colors placeholder:text-[hsl(var(--tu-fg-muted))] hover:border-[hsl(var(--tu-fg-muted))] focus:border-[hsl(var(--tu-brand))] focus:ring-2 focus:ring-[hsl(var(--tu-brand))]/20 disabled:opacity-50 disabled:cursor-not-allowed " + sizeClass(props.size),
)
