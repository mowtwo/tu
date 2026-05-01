// Live Tu editor — Monaco editor on the left, mounted preview on the right.
// `compile` runs in the browser via @tu-lang/compiler (it's pure-JS ESM,
// no Node deps). The result is executed in main.js by the Function
// constructor with `h` / `Signal` injected as parameters (sidestepping
// bare-module-import resolution in eval).
//
// `error` is a reactive cell (toggles the preview pane between live mount
// and red-diagnostic). The editor itself is owned by Monaco — we render
// an empty `#live-source` div, then main.js calls `createTuEditor()` to
// boot Monaco into it after the Tu chrome has rendered.

export let error = ""

export let LiveEditor = () => div(class: "h-full grid grid-cols-1 md:grid-cols-2 gap-4") {
  div(class: "flex flex-col gap-2 min-h-0") {
    div(class: "flex items-center justify-between") {
      h3(class: "text-sm font-semibold m-0 text-[hsl(var(--tu-fg))]") { "Source" }
      span(class: "text-xs text-[hsl(var(--tu-fg-muted))]") { "(auto-recompile on edit)" }
    }
    div(
      id: "live-source",
      class: "flex-1 min-h-[400px] border border-[hsl(var(--tu-border))] rounded-[var(--tu-radius-sm)] overflow-hidden",
    )
  }
  div(class: "flex flex-col gap-2 min-h-0") {
    div(class: "flex items-center justify-between") {
      h3(class: "text-sm font-semibold m-0 text-[hsl(var(--tu-fg))]") { "Preview" }
      if (error) {
        span(class: "text-xs text-[hsl(var(--tu-danger))]") { "✗ compile error" }
      } else {
        span(class: "text-xs text-[hsl(var(--tu-success))]") { "✓ live" }
      }
    }
    if (error) {
      pre(class: "flex-1 min-h-[400px] p-3 text-xs font-mono border rounded-[var(--tu-radius-sm)] overflow-auto whitespace-pre-wrap text-[hsl(var(--tu-danger))] bg-[hsl(var(--tu-danger))]/10 border-[hsl(var(--tu-danger))]/30") { error }
    } else {
      div(
        id: "live-preview-mount",
        class: "flex-1 min-h-[400px] p-4 bg-[hsl(var(--tu-surface))] border border-[hsl(var(--tu-border))] rounded-[var(--tu-radius-sm)] overflow-auto",
      )
    }
  }
}
