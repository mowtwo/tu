// Live Tu editor — RIGHT pane only (preview / error toggle).
//
// IMPORTANT: the *editor* (Monaco's host div) is intentionally NOT
// rendered by this component. It lives in plain DOM, set up by
// live-demo.js as a sibling of the mount point that this component
// renders into. Why: Tu's keyed-diff re-runs the whole component thunk
// when any read cell changes, and Monaco fills its host div with a
// large internal DOM tree that the diff doesn't know about. Touching
// the host on every error-toggle wipes the editor. Keeping it outside
// the Tu render tree side-steps that interaction entirely.
//
// `error` is the only reactive surface here — it flips the right pane
// between a live preview mount and a red diagnostic block.

export let error = ""

export let LiveEditor = () => div(class: "flex flex-col gap-2 min-h-0 h-full") {
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
