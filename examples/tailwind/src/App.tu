// Tu × Tailwind v4 demo. Components mix:
//   • Tailwind utility classes via `class: "px-4 py-2 …"` (Tailwind's
//     content scanner picks these up automatically when @source points
//     at .tu files — see styles.css).
//   • Tu's `style { … }` block for component-scoped CSS that doesn't fit
//     the utility-first model (custom keyframes, complex selectors).
//   • Tu's reactive cells driving content + state.

export let count = 0

let inc = () => count = count + 1
let dec = () => count = count - 1

export let App = () => div(class: "max-w-2xl mx-auto p-8 space-y-6") {
  header {
    h1(class: "text-4xl font-bold tracking-tight bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent") {
      "Tu × Tailwind"
    }
    p(class: "mt-2 text-slate-400") {
      "Utility-first styling alongside Tu's reactive components."
    }
  }

  div(class: "rounded-xl border border-slate-800 bg-slate-900/50 backdrop-blur p-6") {
    p(class: "text-sm uppercase tracking-wider text-slate-500 mb-2") { "Counter" }
    p(class: "text-6xl font-bold text-indigo-400 tabular-nums") { count }

    div(class: "mt-4 flex gap-2") {
      button(
        class: "px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white font-medium transition-colors",
        onClick: inc,
      ) { "+1" }
      button(
        class: "px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition-colors",
        onClick: dec,
      ) { "−1" }
    }
  }

  // Demo: a Tu-scoped style block AND Tailwind utilities on the same
  // element — they coexist freely. The scoped class gets per-component
  // hashing so it never collides with global Tailwind utilities.
  .badge() {
    span(class: "inline-flex items-center gap-2") {
      span(class: "w-2 h-2 rounded-full bg-emerald-400 animate-pulse")
      "Live reactive"
    }

    style {
      .badge {
        display: inline-block;
        padding: 0.25rem 0.75rem;
        border: 1px solid rgba(110, 231, 183, 0.3);
        border-radius: 9999px;
        background: rgba(16, 185, 129, 0.1);
        color: rgb(110, 231, 183);
        font-size: 0.875rem;
      }
    }
  }
}
