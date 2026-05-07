// Tu playground bootstrap — fully Tu-native (no .js/.ts shim).
//
// What lives here:
//   1. demo registry (id → setup/thunk/teardown/controls)
//   2. shareable path routing → Sidebar.activeId cell
//   3. demo lifecycle (mount, teardown previous, swap into #mount)
//   4. Diff demo's setInterval ticker + array shuffle controls — the
//      shuffle uses a Fisher-Yates loop that needs JS-style for(;;) so
//      it sits in an `external JS` block.
//   5. Live-editor demo lazy-loaded on first navigation to `/live`
//      (Monaco + @tu-lang/compiler in the browser); kept in
//      live-demo.js to keep it out of the initial bundle.

import { mount } from "@tu-lang/dom"
import { createRouter } from "@tu-lang/router"
import { now } from "@tu-lang/std/time"

import * as Sidebar from "./Sidebar.tu"
import * as Header from "./StageHeader.tu"

import * as HelloMod from "../../examples/hello/Greeting.tu"
import * as CounterMod from "../../examples/counter/Counter.tu"
import * as TodoMod from "../../examples/todo/Todo.tu"
import * as CardMod from "../../examples/styled/Card.tu"
import * as ClickerMod from "../../examples/clicker/Clicker.tu"
import * as DiffMod from "../../examples/diff/Diff.tu"
import * as ScopedMod from "../../examples/scoped/Scoped.tu"
import * as CompositionMod from "../../examples/composition/Composition.tu"
import * as TypedMod from "../../examples/typed/Typed.tu"
import * as TuXingMod from "../../examples/tu-xing-demo/src/App.tu"
import * as TailwindMod from "../../examples/tailwind/src/App.tu"

// Module-level mutable state flips through cells; Tu auto-wraps and
// injects .get/.set at use sites, so reads/writes here read like plain
// variables.
let diffTickHandle = null
let stop = null
let activeDemo = null
let liveDemoPromise = null

let playgroundBase = external JS (): string {
  return import.meta.env.BASE_URL.replace(/\/$/, "")
}

let routeBase = playgroundBase()

// `demoBlurbs` is rebuilt fresh on every read — wrapping it in a
// lambda factory side-steps Tu's auto-cell-wrap on object literals
// while keeping the call-site ergonomic.
let demoBlurbs = () => ({
  hello: "Static component compiled to ESM and rendered to DOM. No reactivity.",
  counter:
    "`let count = 0` auto-binds to a Signal cell. `computed(...)` cells re-derive on mutation. M1.14: Counter.tu now owns its `+` / `−` / `reset` buttons via private `inc / dec / reset` lambdas — no external wiring.",
  todo:
    "Control flow: `for item in items`, plus chained `if (count == 0) … else if (count == 1) … else …` for the pluralized label. M2.5: Todo.tu now owns its empty/one/three-items buttons via array literals — no external wiring.",
  card:
    "`style { ... }` block (M1.4) + symbolic class refs `.card()` and `class: .card__title` (M1.8). The compiler hashes every declared class with a per-component suffix, so the markup attribute and the CSS selector match up while staying isolated from other components.",
  clicker:
    "Fully interactive — `count = count + 1` mutates the cell, `onClick: ...` wires up event listeners, mount() re-renders the DOM on every change.",
  scoped:
    "Two components both declare a `.card` style. Symbolic class refs (`.card()` shorthand and `class: .card`) get a per-component hash suffix in markup AND CSS, so the rules don't bleed across components.",
  composition:
    "Capitalized components compile as real function calls (not `h(\"Card\", …)`), so hover and goto-definition work on `Layout` / `Card`. The trailing `{ … }` block becomes the component's `children` argument. `Fragment` from `@tu-lang/runtime` lets a component return multiple sibling vnodes. Local `let` inside a component body is a plain const (not a Signal cell).",
  typed:
    "M5.6 + M5.7 + M5.8: object literals (`{ x: 1, y: 2 }`), lambda return-type annotations (`(n): Point => …`), type aliases, and member access (`origin.x`). The whole typed-data path round-trips reactively through state and computed cells.",
  "tu-xing":
    "@tu-lang/tu-xing 图形 — Tu-native UI library. Buttons / Inputs / Cards / Badges / Switch / Dialog / Tabs, all styled via Tailwind utilities referencing the theme tokens in `theme.css`. Every component is a `.tu` file; consumers import with `@tu-lang/vite`.",
  tailwind:
    "Tu × Tailwind v4 — utility classes coexist with Tu scoped style blocks. Tailwind's `@source \"**/*.tu\"` directive lets it scan `.tu` source files for class usage. M5.9 method calls (`e.preventDefault()`) shipped specifically to make Tailwind interactions work cleanly.",
  diff:
    "Keyed diff — the counter cell ticks every 600 ms in the background. Click into the input and type: focus + caret + your text all survive the re-renders, because M1.7 reuses the existing input DOM node rather than rebuilding it. Then try the list buttons — DOM identity is preserved across reorders too.",
  live: "Loading the in-browser editor…",
})

// Fisher-Yates needs imperative reverse iteration + index swaps; Tu's
// `for x in xs` is array-yielding so it can't express the in-place
// permutation. Drop into raw JS for this one helper.
let shuffleInPlace = external JS (arr: any[]): any[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
  return arr
}

let demos = () => [
  { id: "hello", setup: () => null, thunk: () => HelloMod.Greeting({ name: "World" }) },
  {
    id: "counter",
    setup: () => CounterMod.count.set(0),
    thunk: () => CounterMod.Counter(),
  },
  {
    id: "todo",
    setup: () => {
      TodoMod.items.set([])
      TodoMod.count.set(0)
    },
    thunk: () => TodoMod.Todo(),
  },
  {
    id: "card",
    setup: () => null,
    thunk: () =>
      CardMod.Card({
        title: "Tu",
        body: "A reactive UI language with first-class style blocks.",
      }),
  },
  {
    id: "clicker",
    setup: () => ClickerMod.count.set(0),
    thunk: () => ClickerMod.Clicker(),
  },
  { id: "scoped", setup: () => null, thunk: () => ScopedMod.Scoped() },
  { id: "composition", setup: () => null, thunk: () => CompositionMod.App() },
  {
    id: "typed",
    setup: () => TypedMod.n.set(1),
    thunk: () => TypedMod.App(),
  },
  {
    id: "tu-xing",
    setup: () => {
      TuXingMod.count.set(0)
      TuXingMod.dialogOpen.set(false)
      TuXingMod.switchOn.set(false)
      TuXingMod.activeTab.set("buttons")
      TuXingMod.inputValue.set("")
    },
    thunk: () => TuXingMod.App(),
  },
  {
    id: "tailwind",
    setup: () => TailwindMod.count.set(0),
    thunk: () => TailwindMod.App(),
  },
  {
    id: "diff",
    setup: () => {
      DiffMod.count.set(0)
      DiffMod.items.set(["Apple", "Banana", "Cherry", "Date"])
      diffTickHandle = setInterval(() => {
        DiffMod.count.set(DiffMod.count.get() + 1)
      }, 600)
    },
    teardown: () => {
      if (diffTickHandle != null) {
        clearInterval(diffTickHandle)
        diffTickHandle = null
      }
    },
    thunk: () => DiffMod.Diff(),
    controls: () => [
      {
        label: "shuffle list",
        run: () => DiffMod.items.set(shuffleInPlace([...DiffMod.items.get()])),
      },
      {
        label: "insert middle",
        run: () => {
          let arr = [...DiffMod.items.get()]
          let fresh = `New ${now.instant().epochMilliseconds % 1000}`
          arr.splice(Math.floor(arr.length / 2), 0, fresh)
          DiffMod.items.set(arr)
        },
      },
      { label: "remove first", run: () => DiffMod.items.set(DiffMod.items.get().slice(1)) },
      {
        label: "reset list",
        run: () => DiffMod.items.set(["Apple", "Banana", "Cherry", "Date"]),
      },
    ],
  },
]

let loadLiveDemo = () => {
  if (!liveDemoPromise) {
    liveDemoPromise = import("./live-demo.tu").then((m) => {
      // `liveDemo` / `liveDemoBlurb` are exported as lambda factories —
      // Tu cell-wraps every non-lambda module `let`, so a namespace
      // `m.liveDemo` would otherwise be a Signal.State instance (no
      // `.setup` field). Invoking the factory yields the actual value.
      liveBlurbOverride = m.liveDemoBlurb()
      return m.liveDemo()
    })
  }
  return liveDemoPromise
}

let liveBlurbOverride = null

let blurbFor = (id: string): string => {
  if (id == "live" && liveBlurbOverride != null) { return liveBlurbOverride }
  let table = demoBlurbs()
  return table[id] ?? ""
}

let labelFor = (id: string): string => {
  let map = {
    hello: "M1.0  Hello",
    counter: "M1.2  Counter",
    todo: "M1.3  Todo",
    card: "M1.4  Card",
    clicker: "M1.5  Clicker",
    scoped: "M1.8  Scoped",
    composition: "M5    Composition",
    typed: "M5.6/7/8  Typed",
    "tu-xing": "图形  tu-xing UI library",
    tailwind: "M6.3  Tu × Tailwind",
    diff: "M1.7  Diff",
    live: "图  Live editor",
  }
  return map[id] ?? id
}

// Diff demo's controls render as plain DOM (not Tu vnodes) because
// they're appended *outside* the Tu mount root. We rebuild them on
// every demo activation; previous controls are removed first.
let renderControls = (controlsHost: Element, controls: Array<{label: string, run: () => void}>) => {
  controls.forEach((c) => {
    let btn = document.createElement("button")
    btn.type = "button"
    btn.textContent = c.label
    btn.addEventListener("click", c.run)
    controlsHost.appendChild(btn)
  })
}

let activate = (demo, sidebarEl: Element, headerEl: Element, mountEl: Element) => {
  if (stop) {
    stop()
    stop = null
  }
  if (activeDemo) { activeDemo.teardown?.() }
  activeDemo = demo

  let label = labelFor(demo.id)
  Sidebar.activeId.set(demo.id)
  Header.title.set(label)
  Header.blurb.set(blurbFor(demo.id))

  let parent = headerEl.parentElement
  let oldControls = parent.querySelector(":scope > .controls")
  if (oldControls) { oldControls.remove() }
  if (demo.controls) {
    let controlsEl = document.createElement("div")
    controlsEl.className = "controls"
    renderControls(controlsEl, demo.controls())
    parent.appendChild(controlsEl)
  }

  demo.setup()
  stop = mount(demo.thunk, mountEl)
  demo.afterMount?.()
}

let playgroundRoutes = () => {
  let routes = demos().map((demo) => ({
    path: "/" + demo.id,
    handler: () => demo.id,
  }))
  routes.push({ path: "/live", handler: () => "live" })
  return createRouter(routes, { base: routeBase || "/" })
}

let demoHref = (id: string): string => (routeBase || "") + "/" + id

let closestAnchorHref = external JS (target: EventTarget | null): string | null {
  const el = target instanceof Element
    ? target
    : target instanceof Node
      ? target.parentElement
      : null
  return el?.closest("a")?.getAttribute("href") ?? null
}

let isPlaygroundHref = (href: string): boolean => {
  if (routeBase) {
    return href == routeBase || href.startsWith(routeBase + "/")
  }
  return href == "/live" || demos().some((demo) => href == "/" + demo.id)
}

let currentRouteId = (): string => {
  let hash = window.location.hash.slice(1)
  if (hash) {
    history.replaceState(null, "", demoHref(hash))
    return hash
  }
  let match = playgroundRoutes().match(window.location.pathname)
  if (match) {
    return match.handler(match.ctx)
  }
  return demos()[0].id
}

let navigateToPath = (href: string): void => {
  if (window.location.pathname != href) {
    history.pushState(null, "", href)
  }
  activateFromRoute()
}

let activateFromRoute = async () => {
  let sidebarEl = document.getElementById("sidebar-host")
  let headerEl = document.getElementById("header-host")
  let mountEl = document.getElementById("mount")
  let id = currentRouteId()
  let next = null
  if (id == "live") {
    // Show the loading blurb immediately so the user sees feedback,
    // then swap in the real demo when the chunk lands. Re-check the
    // hash after the await — the user may have navigated elsewhere
    // while the chunk was downloading.
    Sidebar.activeId.set("live")
    Header.title.set(labelFor("live"))
    Header.blurb.set(blurbFor("live"))
    next = await loadLiveDemo()
    if (currentRouteId() != "live") { return }
  } else {
    let list = demos()
    next = list.find((d) => d.id == id) ?? list[0]
    if (next.id != id) {
      history.replaceState(null, "", demoHref(next.id))
    }
  }
  if (activeDemo == null || next.id != activeDemo.id) {
    activate(next, sidebarEl, headerEl, mountEl)
  }
}

// Bootstrap: wrap side-effects in a lambda invoked once at module
// load. Tu's top level only accepts let/import/type-alias/etc. so an
// init thunk that runs immediately is the conventional pattern for
// imperative setup.
let _bootstrap = (() => {
  let sidebarEl = document.getElementById("sidebar-host")
  let headerEl = document.getElementById("header-host")
  mount(() => Sidebar.Sidebar(), sidebarEl)
  mount(() => Header.StageHeader(), headerEl)
  sidebarEl.addEventListener("click", (event) => {
    let href = closestAnchorHref(event.target)
    if (!href || !isPlaygroundHref(href)) { return }
    event.preventDefault()
    navigateToPath(href)
  })
  window.addEventListener("popstate", activateFromRoute)
  activateFromRoute()
})()
