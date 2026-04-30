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
    blurb: '`let count = 0` auto-binds to a Signal cell. `computed(...)` cells re-derive on mutation. Use the buttons in the header to mutate.',
    setup() {
      CounterMod.count.set(0)
    },
    thunk: () => CounterMod.Counter(),
    controls: () => [
      { label: 'count.set(5)', run: () => CounterMod.count.set(5) },
      { label: 'count.set(15)', run: () => CounterMod.count.set(15) },
      { label: 'reset', run: () => CounterMod.count.set(0) },
    ],
  },
  {
    id: 'todo',
    label: 'M1.3  Todo',
    blurb: 'Control flow: `for item in items`, plus chained `if (count == 0) … else if (count == 1) … else …` for the pluralized label. The header buttons swap the items list.',
    setup() {
      TodoMod.items.set([])
      TodoMod.count.set(0)
    },
    thunk: () => TodoMod.Todo(),
    controls: () => [
      {
        label: 'empty',
        run: () => {
          TodoMod.items.set([])
          TodoMod.count.set(0)
        },
      },
      {
        label: 'one item',
        run: () => {
          TodoMod.items.set(['buy milk'])
          TodoMod.count.set(1)
        },
      },
      {
        label: 'three items',
        run: () => {
          TodoMod.items.set(['buy milk', 'walk the dog', 'write Tu'])
          TodoMod.count.set(3)
        },
      },
    ],
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
    blurb: 'Keyed diff — focus + caret in the input survive unrelated cell mutation; reordering the `<li>` list with `key:` moves DOM nodes instead of recreating them.',
    setup() {
      DiffMod.count.set(0)
      DiffMod.items.set(['Apple', 'Banana', 'Cherry', 'Date'])
    },
    thunk: () => DiffMod.Diff(),
    controls: () => [
      {
        label: 'tick count',
        run: () => DiffMod.count.set(DiffMod.count.get() + 1),
      },
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
        label: 'reset',
        run: () => {
          DiffMod.count.set(0)
          DiffMod.items.set(['Apple', 'Banana', 'Cherry', 'Date'])
        },
      },
    ],
  },
]

const mountEl = document.getElementById('mount')
const navEl = document.getElementById('demos')
const titleEl = document.getElementById('demo-title')
const blurbEl = document.getElementById('demo-blurb')
const headerEl = document.querySelector('.stage__header')

let stop = null
let activeId = null

function activate(demo) {
  if (stop) {
    stop()
    stop = null
  }
  activeId = demo.id
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
