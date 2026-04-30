import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { h, mount, Signal } from '../src/index.js'

// jsdom plumbing: install document/Element on globalThis so the runtime's
// browser-only code (mount + materialize) can find them.
let dom: JSDOM
beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  ;(globalThis as unknown as { document: Document }).document = dom.window.document
  ;(globalThis as unknown as { Element: typeof Element }).Element = dom.window.Element as never
  ;(globalThis as unknown as { Node: typeof Node }).Node = dom.window.Node as never
  ;(globalThis as unknown as { Event: typeof Event }).Event = dom.window.Event as never
})
afterEach(() => {
  dom.window.close()
})

const flush = () => new Promise<void>((r) => queueMicrotask(r))

describe('mount()', () => {
  it('renders a static vnode and tears down on stop', () => {
    const root = dom.window.document.getElementById('root')!
    const stop = mount(() => h('p', { class: 'g' }, ['hi']), root)
    expect(root.innerHTML).toBe('<p class="g">hi</p>')
    stop()
  })

  it('re-renders when a Signal cell read by the thunk mutates', async () => {
    const root = dom.window.document.getElementById('root')!
    const count = new Signal.State(0)
    const stop = mount(() => h('p', {}, [count.get()]), root)
    expect(root.innerHTML).toBe('<p>0</p>')

    count.set(7)
    await flush()
    expect(root.innerHTML).toBe('<p>7</p>')

    count.set(42)
    await flush()
    expect(root.innerHTML).toBe('<p>42</p>')

    stop()
  })

  it('wires onClick to addEventListener and updates DOM after the click', async () => {
    const root = dom.window.document.getElementById('root')!
    const count = new Signal.State(0)
    const inc = () => count.set(count.get() + 1)
    const stop = mount(
      () =>
        h('div', {}, [
          h('span', {}, [count.get()]),
          h('button', { onClick: inc, id: 'b' }, ['+']),
        ]),
      root
    )
    expect(root.innerHTML).toBe('<div><span>0</span><button id="b">+</button></div>')

    const btn = dom.window.document.getElementById('b')!
    btn.dispatchEvent(new dom.window.Event('click', { bubbles: true }))
    await flush()
    expect(root.innerHTML).toBe('<div><span>1</span><button id="b">+</button></div>')

    btn.dispatchEvent(new dom.window.Event('click', { bubbles: true }))
    btn.dispatchEvent(new dom.window.Event('click', { bubbles: true }))
    await flush()
    expect(root.innerHTML).toBe('<div><span>3</span><button id="b">+</button></div>')

    stop()
  })

  it('stop() unsubscribes AND removes the mounted DOM from the container', async () => {
    const root = dom.window.document.getElementById('root')!
    const count = new Signal.State(0)
    const stop = mount(() => h('p', {}, [count.get()]), root)
    expect(root.innerHTML).toBe('<p>0</p>')
    stop()
    // DOM is gone (mount cleans up its own subtree on stop) AND further
    // mutations don't re-render.
    expect(root.innerHTML).toBe('')
    count.set(99)
    await flush()
    expect(root.innerHTML).toBe('')
  })

  it('mounting a second component into the same container after stop() does not stack', async () => {
    // Regression for the playground sidebar bug: switching between demos
    // accumulated stale DOM because the previous mount's tree was never
    // removed. After M2's mount-cleanup fix, only the active component
    // is in the container.
    const root = dom.window.document.getElementById('root')!
    const stopA = mount(() => h('p', {}, ['A']), root)
    expect(root.innerHTML).toBe('<p>A</p>')
    stopA()
    expect(root.innerHTML).toBe('')
    const stopB = mount(() => h('p', {}, ['B']), root)
    expect(root.innerHTML).toBe('<p>B</p>')
    stopB()
    expect(root.innerHTML).toBe('')
  })

  it('stop() leaves sibling DOM nodes (outside the mount) untouched', () => {
    // mount() should ONLY remove the subtree it created, not other
    // children of the same container.
    const root = dom.window.document.getElementById('root')!
    const sibling = dom.window.document.createElement('span')
    sibling.textContent = 'pre-existing'
    root.appendChild(sibling)
    const stop = mount(() => h('p', {}, ['mounted']), root)
    expect(root.innerHTML).toContain('pre-existing')
    expect(root.innerHTML).toContain('<p>mounted</p>')
    stop()
    expect(root.innerHTML).toBe('<span>pre-existing</span>')
  })
})
