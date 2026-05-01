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

function attachLiveCompiler() {
  const host = document.getElementById('live-source')
  if (!host) return
  const { editor, dispose } = createTuEditor(host, LIVE_DEMO_SOURCE)
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
