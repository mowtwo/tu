// tu-xing Badge — pill-shaped status indicator.
//
// Usage: Badge(variant: "success") { "Active" }

export type BadgeVariant = "brand" | "success" | "warning" | "danger" | "outline"

export interface BadgeProps {
  variant?: BadgeVariant
  children?: Child[]
}

let variantClass = (v: string): string =>
  if (v == "success") { "bg-[hsl(var(--tu-success))]/15 text-[hsl(var(--tu-success))] border-[hsl(var(--tu-success))]/30" }
  else if (v == "warning") { "bg-[hsl(var(--tu-warning))]/15 text-[hsl(var(--tu-warning))] border-[hsl(var(--tu-warning))]/30" }
  else if (v == "danger") { "bg-[hsl(var(--tu-danger))]/15 text-[hsl(var(--tu-danger))] border-[hsl(var(--tu-danger))]/30" }
  else if (v == "outline") { "bg-transparent text-[hsl(var(--tu-fg-muted))] border-[hsl(var(--tu-border))]" }
  else { "bg-[hsl(var(--tu-brand))]/15 text-[hsl(var(--tu-brand))] border-[hsl(var(--tu-brand))]/30" }

export let Badge = (props: BadgeProps) => span(
  class: "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border " + variantClass(props.variant ?? "brand"),
) { props.children }
