// Reactive stage header — title + blurb, themed via tu-xing tokens.
//
// `title` and `blurb` are exported state cells; main.js sets them on
// every demo activation, the keyed-diff runtime patches just the text
// nodes that changed.

export let title = ""
export let blurb = ""

export let StageHeader = () => header(
  class: "px-8 py-6 border-b border-[hsl(var(--tu-border))] bg-[hsl(var(--tu-surface))]",
) {
  h2(class: "text-2xl font-semibold tracking-tight text-[hsl(var(--tu-fg))] m-0") { title }
  p(class: "mt-2 text-sm leading-relaxed text-[hsl(var(--tu-fg-muted))] m-0") { blurb }
}
