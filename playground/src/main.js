import { mount } from '@tu/runtime'

import * as HelloMod from '../../examples/hello/Greeting.tu'
import * as CounterMod from '../../examples/counter/Counter.tu'
import * as TodoMod from '../../examples/todo/Todo.tu'
import * as CardMod from '../../examples/styled/Card.tu'
import * as ClickerMod from '../../examples/clicker/Clicker.tu'
import * as DiffMod from '../../examples/diff/Diff.tu'
import * as ScopedMod from '../../examples/scoped/Scoped.tu'

// Each demo: id, label, blurb, render thunk that returns a Tu vnode (or array
// fragment). Some demos (counter / todo) seed their state cells before mount
// so the playground shows non-empty content out of the gate.
const demos = [
  {
    id: 'hello',
    label: 'M1.0  Hello',
    blurb: 'Static component compiled to ESM and rendered to DOM. No reactivity.',
    setup() {},
    thunk: () => HelloMod.Greeting('World'),
  },
  {
    id: 'counter',
    label: 'M1.2  Counter',
    blurb: '`let count = 0` auto-binds to a Signal cell. `computed(...)` cells re-derive on mutation. M1.14: Counter.tu now owns its `+` / `−` / `reset` buttons via private `inc / dec / reset` lambdas — no external wiring.',
    setup() {
      CounterMod.count.set(0)
    },
    thunk: () => CounterMod.Counter(),
  },
  {
    id: 'todo',
    label: 'M1.3  Todo',
    blurb: 'Control flow: `for item in items`, plus chained `if (count == 0) … else if (count == 1) … else …` for the pluralized label. M2.5: Todo.tu now owns its empty/one/three-items buttons via array literals — no external wiring.',
    setup() {
      TodoMod.items.set([])
      TodoMod.count.set(0)
    },
    thunk: () => TodoMod.Todo(),
  },
  {
    id: 'card',
    label: 'M1.4  Card',
    blurb: '`style { ... }` block (M1.4) + symbolic class refs `.card()` and `class: .card__title` (M1.8). The compiler hashes every declared class with a per-component suffix, so the markup attribute and the CSS selector match up while staying isolated from other components.',
    setup() {},
    thunk: () => CardMod.Card('Tu', 'A reactive UI language with first-class style blocks.'),
  },
  {
    id: 'clicker',
    label: 'M1.5  Clicker',
    blurb: 'Fully interactive — `count = count + 1` mutates the cell, `onClick: ...` wires up event listeners, mount() re-renders the DOM on every change.',
    setup() {
      ClickerMod.count.set(0)
    },
    thunk: () => ClickerMod.Clicker(),
  },
  {
    id: 'scoped',
    label: 'M1.8  Scoped',
    blurb: 'Two components both declare a `.card` style. Symbolic class refs (`.card()` shorthand and `class: .card`) get a per-component hash suffix in markup AND CSS, so the rules don\'t bleed across components.',
    setup() {},
    thunk: () => ScopedMod.Scoped(),
  },
  {
    id: 'diff',
    label: 'M1.7  Diff',
    blurb: 'Keyed diff — the counter cell ticks every 600 ms in the background. Click into the input and type: focus + caret + your text all survive the re-renders, because M1.7 reuses the existing input DOM node rather than rebuilding it. Then try the list buttons — DOM identity is preserved across reorders too.',
    setup() {
      DiffMod.count.set(0)
      DiffMod.items.set(['Apple', 'Banana', 'Cherry', 'Date'])
      // Auto-tick the count cell — the demo's whole point is "cell mutates,
      // input survives." If the trigger is a button click, the click steals
      // focus from the input the instant we want to verify focus is kept.
      // setInterval has no DOM focus to steal.
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
      {
        label: 'remove first',
        run: () => DiffMod.items.set(DiffMod.items.get().slice(1)),
      },
      {
        label: 'reset list',
        run: () => DiffMod.items.set(['Apple', 'Banana', 'Cherry', 'Date']),
      },
    ],
  },
]

let diffTickHandle = null

const mountEl = document.getElementById('mount')
const navEl = document.getElementById('demos')
const titleEl = document.getElementById('demo-title')
const blurbEl = document.getElementById('demo-blurb')
const headerEl = document.querySelector('.stage__header')

let stop = null
let activeId = null
let activeDemo = null

function activate(demo) {
  if (stop) {
    stop()
    stop = null
  }
  // Tear down the previous demo before swapping. setInterval handles, etc.
  // need a chance to clear so they don't keep firing while another demo is
  // mounted.
  if (activeDemo?.teardown) activeDemo.teardown()
  activeId = demo.id
  activeDemo = demo
  for (const link of navEl.querySelectorAll('a')) {
    link.classList.toggle('is-active', link.dataset.id === demo.id)
  }
  titleEl.textContent = demo.label
  blurbEl.textContent = demo.blurb

  // Reset any per-demo controls left over from the previous demo.
  const oldControls = headerEl.querySelector('.controls')
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
    headerEl.appendChild(controlsEl)
  }

  demo.setup()
  stop = mount(demo.thunk, mountEl)
}

for (const demo of demos) {
  const link = document.createElement('a')
  link.href = `#${demo.id}`
  link.dataset.id = demo.id
  link.textContent = demo.label
  link.addEventListener('click', (e) => {
    e.preventDefault()
    history.replaceState(null, '', `#${demo.id}`)
    activate(demo)
  })
  navEl.appendChild(link)
}

function activateFromHash() {
  const id = window.location.hash.slice(1)
  const next = demos.find((d) => d.id === id) ?? demos[demos.length - 1]
  if (next.id !== activeId) activate(next)
}

window.addEventListener('hashchange', activateFromHash)
activateFromHash()
