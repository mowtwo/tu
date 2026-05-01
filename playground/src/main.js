// Tu playground bootstrap.
//
// The two big chunks of imperative DOM creation that used to live here —
// the sidebar nav and the stage header — are now Tu components (Sidebar.tu
// + StageHeader.tu). This file shrinks to:
//   1. demo registry (id → setup/thunk/teardown/controls)
//   2. hash-routing → Sidebar.activeId cell
//   3. demo lifecycle (mount, teardown previous, swap into #mount)
//   4. Diff-only setInterval + array-controls (escape hatch — these need
//      JS-side `[...]` spread + Math.random which Tu V1 doesn't surface).
//   5. Live-editor recompile pipeline — compileToTS-less in-browser
//      compile via @tu-lang/compiler's pure-JS ESM, then eval via the
//      Function constructor with `h` / `Signal` injected.
import { h, mount, Signal } from '@tu-lang/runtime'
import { compile } from '@tu-lang/compiler'

import * as Sidebar from './Sidebar.tu'
import * as Header from './StageHeader.tu'
import * as LiveEditorMod from './LiveEditor.tu'

import * as HelloMod from '../../examples/hello/Greeting.tu'
import * as CounterMod from '../../examples/counter/Counter.tu'
import * as TodoMod from '../../examples/todo/Todo.tu'
import * as CardMod from '../../examples/styled/Card.tu'
import * as ClickerMod from '../../examples/clicker/Clicker.tu'
import * as DiffMod from '../../examples/diff/Diff.tu'
import * as ScopedMod from '../../examples/scoped/Scoped.tu'
import * as CompositionMod from '../../examples/composition/Composition.tu'
import * as TypedMod from '../../examples/typed/Typed.tu'
import * as TuXingMod from '../../examples/tu-xing-demo/src/App.tu'
import * as TailwindMod from '../../examples/tailwind/src/App.tu'

const demoBlurbs = {
  hello: 'Static component compiled to ESM and rendered to DOM. No reactivity.',
  counter:
    '`let count = 0` auto-binds to a Signal cell. `computed(...)` cells re-derive on mutation. M1.14: Counter.tu now owns its `+` / `−` / `reset` buttons via private `inc / dec / reset` lambdas — no external wiring.',
  todo:
    'Control flow: `for item in items`, plus chained `if (count == 0) … else if (count == 1) … else …` for the pluralized label. M2.5: Todo.tu now owns its empty/one/three-items buttons via array literals — no external wiring.',
  card:
    '`style { ... }` block (M1.4) + symbolic class refs `.card()` and `class: .card__title` (M1.8). The compiler hashes every declared class with a per-component suffix, so the markup attribute and the CSS selector match up while staying isolated from other components.',
  clicker:
    'Fully interactive — `count = count + 1` mutates the cell, `onClick: ...` wires up event listeners, mount() re-renders the DOM on every change.',
  scoped:
    "Two components both declare a `.card` style. Symbolic class refs (`.card()` shorthand and `class: .card`) get a per-component hash suffix in markup AND CSS, so the rules don't bleed across components.",
  composition:
    "Capitalized components compile as real function calls (not `h(\"Card\", …)`), so hover and goto-definition work on `Layout` / `Card`. The trailing `{ … }` block becomes the component's `children` argument. `Fragment` from `@tu-lang/runtime` lets a component return multiple sibling vnodes. Local `let` inside a component body is a plain const (not a Signal cell).",
  typed:
    'M5.6 + M5.7 + M5.8: object literals (`{ x: 1, y: 2 }`), lambda return-type annotations (`(n): Point => …`), type aliases, and member access (`origin.x`). The whole typed-data path round-trips reactively through state and computed cells.',
  'tu-xing':
    '@tu-lang/tu-xing 图形 — Tu-native UI library. Buttons / Inputs / Cards / Badges / Switch / Dialog / Tabs, all styled via Tailwind utilities referencing the theme tokens in `theme.css`. Every component is a `.tu` file; consumers import with `@tu-lang/vite`.',
  tailwind:
    'Tu × Tailwind v4 — utility classes coexist with Tu scoped style blocks. Tailwind\'s `@source "**/*.tu"` directive lets it scan `.tu` source files for class usage. M5.9 method calls (`e.preventDefault()`) shipped specifically to make Tailwind interactions work cleanly.',
  diff:
    "Keyed diff — the counter cell ticks every 600 ms in the background. Click into the input and type: focus + caret + your text all survive the re-renders, because M1.7 reuses the existing input DOM node rather than rebuilding it. Then try the list buttons — DOM identity is preserved across reorders too.",
  live:
    'In-browser Tu compiler — `@tu-lang/compiler` ships as pure-JS ESM, so it bundles into the playground. Edit the source on the left; every keystroke recompiles to JS, the result is `Function`-evaled with `h` + `Signal` injected, and the exported `App` is mounted into the right pane. Errors render where the preview would.',
}

let diffTickHandle = null

const demos = [
  { id: 'hello', setup() {}, thunk: () => HelloMod.Greeting('World') },
  {
    id: 'counter',
    setup() { CounterMod.count.set(0) },
    thunk: () => CounterMod.Counter(),
  },
  {
    id: 'todo',
    setup() {
      TodoMod.items.set([])
      TodoMod.count.set(0)
    },
    thunk: () => TodoMod.Todo(),
  },
  {
    id: 'card',
    setup() {},
    thunk: () =>
      CardMod.Card('Tu', 'A reactive UI language with first-class style blocks.'),
  },
  {
    id: 'clicker',
    setup() { ClickerMod.count.set(0) },
    thunk: () => ClickerMod.Clicker(),
  },
  { id: 'scoped', setup() {}, thunk: () => ScopedMod.Scoped() },
  { id: 'composition', setup() {}, thunk: () => CompositionMod.App() },
  {
    id: 'typed',
    setup() {
      TypedMod.n.set(1)
    },
    thunk: () => TypedMod.App(),
  },
  {
    id: 'tu-xing',
    setup() {
      TuXingMod.count.set(0)
      TuXingMod.dialogOpen.set(false)
      TuXingMod.switchOn.set(false)
      TuXingMod.activeTab.set('buttons')
      TuXingMod.inputValue.set('')
    },
    thunk: () => TuXingMod.App(),
  },
  {
    id: 'tailwind',
    setup() {
      TailwindMod.count.set(0)
    },
    thunk: () => TailwindMod.App(),
  },
  {
    id: 'diff',
    setup() {
      DiffMod.count.set(0)
      DiffMod.items.set(['Apple', 'Banana', 'Cherry', 'Date'])
      diffTickHandle = setInterval(() => {
        DiffMod.count.set(DiffMod.count.get() + 1)
      }, 600)
    },
    teardown() {
      if (diffTickHandle !== null) {
        clearInterval(diffTickHandle)
        diffTickHandle = null
      }
    },
    thunk: () => DiffMod.Diff(),
    controls: () => [
      {
        label: 'shuffle list',
        run: () => {
          const arr = [...DiffMod.items.get()]
          for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1))
            const tmp = arr[i]
            arr[i] = arr[j]
            arr[j] = tmp
          }
          DiffMod.items.set(arr)
        },
      },
      {
        label: 'insert middle',
        run: () => {
          const arr = [...DiffMod.items.get()]
          const fresh = `New ${Date.now() % 1000}`
          arr.splice(Math.floor(arr.length / 2), 0, fresh)
          DiffMod.items.set(arr)
        },
      },
      { label: 'remove first', run: () => DiffMod.items.set(DiffMod.items.get().slice(1)) },
      {
        label: 'reset list',
        run: () => DiffMod.items.set(['Apple', 'Banana', 'Cherry', 'Date']),
      },
    ],
  },
  {
    id: 'live',
    setup() {
      // Reset error so the preview pane shows the live mount, not a
      // stale diagnostic from a previous visit. The textarea content
      // is restored further down via direct DOM manipulation once the
      // pane has rendered (`afterMount`).
      LiveEditorMod.error.set('')
    },
    teardown() {
      stopLivePreview()
    },
    thunk: () => LiveEditorMod.LiveEditor(),
    afterMount: () => attachLiveCompiler(),
  },
]

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
let liveInputHandler = null
let liveTextarea = null
let liveLastCompiled = ''

function stopLivePreview() {
  if (liveStop) {
    liveStop()
    liveStop = null
  }
  if (liveTextarea && liveInputHandler) {
    liveTextarea.removeEventListener('input', liveInputHandler)
  }
  liveTextarea = null
  liveInputHandler = null
  if (liveDebounceHandle !== null) {
    clearTimeout(liveDebounceHandle)
    liveDebounceHandle = null
  }
  liveLastCompiled = ''
}

/** Compile `text`, eval it, and (re-)mount the resulting `App` into
 *  `#live-preview-mount`. Errors flow into the `error` cell so the
 *  preview pane swaps to the red diagnostic. */
function recompileLive(text) {
  if (text === liveLastCompiled) return
  liveLastCompiled = text
  let App
  try {
    // Strip the runtime import emitted by codegen — we provide `h` /
    // `Signal` ourselves via the Function constructor's params, since
    // bare-module imports can't be resolved inside `new Function()`.
    let js = compile(text)
    // Strip the runtime import (we inject `h` / `Signal` via Function
    // params), the source-map footer, and `export` keywords (Function
    // bodies are not modules — `export` is a syntax error there).
    js = js.replace(/^import\s+.*?from\s+['"]@tu-lang\/runtime['"];?\s*/m, '')
    js = js.replace(/\/\/#\s*sourceMappingURL=[^\n]*\n?/g, '')
    js = js.replace(/^export\s+/gm, '')
    const factory = new Function('h', 'Signal', `${js}\nreturn typeof App !== 'undefined' ? App : null`)
    App = factory(h, Signal)
    if (typeof App !== 'function') {
      throw new Error("source must export an `App` lambda — `export let App = () => …`")
    }
    LiveEditorMod.error.set('')
  } catch (e) {
    LiveEditorMod.error.set(e?.message ?? String(e))
    if (liveStop) {
      liveStop()
      liveStop = null
    }
    return
  }
  // Defer mount until the preview pane has rendered after the `error`
  // cell flipped — `error` and the preview-mount node live in opposite
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
  liveTextarea = document.getElementById('live-source')
  if (!liveTextarea) return
  // Restore the starter snippet on every (re-)visit. The textarea is
  // uncontrolled, so the only way to refresh its display is to write
  // to `.value` directly.
  liveTextarea.value = LIVE_DEMO_SOURCE
  recompileLive(LIVE_DEMO_SOURCE)
  liveInputHandler = (e) => {
    if (liveDebounceHandle !== null) clearTimeout(liveDebounceHandle)
    const text = e.target.value
    liveDebounceHandle = setTimeout(() => {
      liveDebounceHandle = null
      recompileLive(text)
    }, 200)
  }
  liveTextarea.addEventListener('input', liveInputHandler)
}

const sidebarEl = document.getElementById('sidebar-host')
const headerEl = document.getElementById('header-host')
const mountEl = document.getElementById('mount')

// Mount the Tu-rendered chrome once. They re-render reactively as their
// exported state cells (Sidebar.activeId, Header.title, Header.blurb) change.
mount(() => Sidebar.Sidebar(), sidebarEl)
mount(() => Header.StageHeader(), headerEl)

let stop = null
let activeDemo = null

function activate(demo) {
  if (stop) {
    stop()
    stop = null
  }
  if (activeDemo?.teardown) activeDemo.teardown()
  activeDemo = demo

  const label = labelFor(demo.id)
  Sidebar.activeId.set(demo.id)
  Header.title.set(label)
  Header.blurb.set(demoBlurbs[demo.id] ?? '')

  // Diff demo's controls live outside the Tu chrome (they need JS-side
  // array spread + Math.random the V1 language doesn't expose). They get
  // appended to the stage header host as a sibling of the Tu-rendered
  // <header>. Reset on every swap.
  const oldControls = headerEl.parentElement.querySelector(':scope > .controls')
  if (oldControls) oldControls.remove()
  if (typeof demo.controls === 'function') {
    const controlsEl = document.createElement('div')
    controlsEl.className = 'controls'
    for (const c of demo.controls()) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.textContent = c.label
      btn.addEventListener('click', c.run)
      controlsEl.appendChild(btn)
    }
    headerEl.parentElement.appendChild(controlsEl)
  }

  demo.setup()
  stop = mount(demo.thunk, mountEl)
  // Some demos need to wire up plain-DOM listeners (e.g. live editor's
  // textarea) once the Tu chrome has rendered. Mount is synchronous, so
  // by the time we get here the DOM exists.
  if (typeof demo.afterMount === 'function') demo.afterMount()
}

function labelFor(id) {
  // Single source of truth for labels lives in Sidebar.tu; mirror just
  // enough here for the stage header. (M5.8 gave Tu member access but not
  // yet a way to expose Tu-defined arrays as plain JS values across the
  // module boundary.)
  const map = {
    hello: 'M1.0  Hello',
    counter: 'M1.2  Counter',
    todo: 'M1.3  Todo',
    card: 'M1.4  Card',
    clicker: 'M1.5  Clicker',
    scoped: 'M1.8  Scoped',
    composition: 'M5    Composition',
    typed: 'M5.6/7/8  Typed',
    'tu-xing': '图形  tu-xing UI library',
    tailwind: 'M6.3  Tu × Tailwind',
    diff: 'M1.7  Diff',
    live: '图  Live editor',
  }
  return map[id] ?? id
}

function activateFromHash() {
  const id = window.location.hash.slice(1)
  const next = demos.find((d) => d.id === id) ?? demos[0]
  if (next.id !== activeDemo?.id) activate(next)
}

window.addEventListener('hashchange', activateFromHash)
activateFromHash()
