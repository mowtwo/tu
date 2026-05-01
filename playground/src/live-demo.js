// Lazy entry for the "Live editor" demo. Anything Monaco-related lives
// in this module so the main playground bundle (~70 kB gzip) doesn't
// ship the editor up-front; it's only fetched when the user navigates
// to `#live`. Returns a demo descriptor identical in shape to the eager
// demos in main.js (id / setup / teardown / thunk / afterMount).

import { compile } from '@tu-lang/compiler'
import { h, mount, Signal } from '@tu-lang/runtime'

import * as LiveEditorMod from './LiveEditor.tu'
import { clearCompileErrors, createTuEditor, setCompileError } from './monaco-tu.js'

const LIVE_DEMO_SOURCE = `let count = 0
let inc = () => count = count + 1

export let App = () => div(class: "live-card") {
  h2 { "Live Tu" }
  p { "count = " count }
  button(onClick: inc) { "+1" }

  style {
    .live-card {
      padding: 1rem 1.25rem;
      border-radius: 8px;
      background: hsl(var(--tu-surface-elevated));
      max-width: 24rem;
    }
  }
}`

let liveStop = null
let liveDebounceHandle = null
let liveEditor = null
let liveEditorDispose = null
let liveContentSub = null
let liveLastCompiled = ''

function stopLivePreview() {
  if (liveStop) {
    liveStop()
    liveStop = null
  }
  if (liveContentSub) {
    liveContentSub.dispose()
    liveContentSub = null
  }
  if (liveEditorDispose) {
    liveEditorDispose()
    liveEditorDispose = null
  }
  liveEditor = null
  if (liveDebounceHandle !== null) {
    clearTimeout(liveDebounceHandle)
    liveDebounceHandle = null
  }
  liveLastCompiled = ''
}

function recompileLive(text) {
  if (text === liveLastCompiled) return
  liveLastCompiled = text
  let App
  try {
    let js = compile(text)
    // Strip the runtime import (we inject `h` / `Signal` via Function
    // params), the source-map footer, and `export` keywords (Function
    // bodies are not modules — `export` is illegal there).
    js = js.replace(/^import\s+.*?from\s+['"]@tu-lang\/runtime['"];?\s*/m, '')
    js = js.replace(/\/\/#\s*sourceMappingURL=[^\n]*\n?/g, '')
    js = js.replace(/^export\s+/gm, '')
    const factory = new Function('h', 'Signal', `${js}\nreturn typeof App !== 'undefined' ? App : null`)
    App = factory(h, Signal)
    if (typeof App !== 'function') {
      throw new Error("source must export an `App` lambda — `export let App = () => …`")
    }
    LiveEditorMod.error.set('')
    if (liveEditor) clearCompileErrors(liveEditor)
  } catch (e) {
    const message = e?.message ?? String(e)
    LiveEditorMod.error.set(message)
    if (liveEditor) setCompileError(liveEditor, message)
    if (liveStop) {
      liveStop()
      liveStop = null
    }
    return
  }
  // Defer mount until the preview pane has rendered after `error`
  // flipped — `error` and the preview-mount node live in opposite
  // arms of the same `if/else`, so the DOM node only exists once
  // `error` is empty.
  queueMicrotask(() => {
    const host = document.getElementById('live-preview-mount')
    if (!host) return
    if (liveStop) liveStop()
    liveStop = mount(() => App(), host)
  })
}

/**
 * Build the live demo's full UI:
 *   #mount
 *     ├─ <div class="grid"> (plain DOM — owned by us)
 *     │    ├─ <div id="live-source"> ← Monaco host (never touched by Tu)
 *     │    └─ <div id="live-right">  ← Tu mount target (LiveEditor component)
 *
 * Tu's component already mounted into #mount before us (via the demo
 * lifecycle). We move its rendered output into the right column and
 * inject the editor column as a sibling. From here Monaco lives in
 * plain DOM and the Tu side only re-renders the right column when
 * `error` flips, so the editor is never wiped.
 */
function attachLiveCompiler() {
  const mountEl = document.getElementById('mount')
  if (!mountEl) return
  // Tu's first render put the right-pane component as #mount's only
  // child. Wrap it in a 2-col grid + an editor host on the left.
  const tuRight = mountEl.firstElementChild
  if (!tuRight) return
  const grid = document.createElement('div')
  grid.className = 'h-full grid grid-cols-1 md:grid-cols-2 gap-4'
  const left = document.createElement('div')
  left.className = 'flex flex-col gap-2 min-h-0'
  const leftHeader = document.createElement('div')
  leftHeader.className = 'flex items-center justify-between'
  leftHeader.innerHTML =
    '<h3 class="text-sm font-semibold m-0 text-[hsl(var(--tu-fg))]">Source</h3>' +
    '<span class="text-xs text-[hsl(var(--tu-fg-muted))]">(auto-recompile on edit)</span>'
  const editorHost = document.createElement('div')
  editorHost.id = 'live-source'
  editorHost.className =
    'flex-1 min-h-[400px] border border-[hsl(var(--tu-border))] rounded-[var(--tu-radius-sm)] overflow-hidden'
  left.appendChild(leftHeader)
  left.appendChild(editorHost)
  grid.appendChild(left)
  // Move Tu's right-pane component into the grid's second column.
  grid.appendChild(tuRight)
  mountEl.appendChild(grid)
  const { editor, dispose } = createTuEditor(editorHost, LIVE_DEMO_SOURCE)
  liveEditor = editor
  liveEditorDispose = dispose
  recompileLive(LIVE_DEMO_SOURCE)
  liveContentSub = editor.onDidChangeModelContent(() => {
    if (liveDebounceHandle !== null) clearTimeout(liveDebounceHandle)
    const text = editor.getValue()
    liveDebounceHandle = setTimeout(() => {
      liveDebounceHandle = null
      recompileLive(text)
    }, 200)
  })
}

export const liveDemo = {
  id: 'live',
  setup() {
    LiveEditorMod.error.set('')
  },
  teardown() {
    stopLivePreview()
  },
  thunk: () => LiveEditorMod.LiveEditor(),
  afterMount: () => attachLiveCompiler(),
}

export const liveDemoBlurb =
  'In-browser Tu compiler — `@tu-lang/compiler` ships as pure-JS ESM, so it bundles into the playground. Edit the source on the left in Monaco; every keystroke recompiles to JS, the result is `Function`-evaled with `h` + `Signal` injected, and the exported `App` is mounted into the right pane. Compile errors render inline with red squiggles, and the preview pane swaps to a red diagnostic block.'
