import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineCustomElement, h, Signal } from '../src/index.js'

let dom: JSDOM
beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>')
  ;(globalThis as unknown as { document: Document }).document = dom.window.document
  ;(globalThis as unknown as { Element: typeof Element }).Element = dom.window.Element as never
  ;(globalThis as unknown as { Node: typeof Node }).Node = dom.window.Node as never
  ;(globalThis as unknown as { Event: typeof Event }).Event = dom.window.Event as never
  ;(globalThis as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement = dom.window.HTMLElement as never
  ;(globalThis as unknown as { customElements: CustomElementRegistry }).customElements =
    dom.window.customElements
})
afterEach(() => {
  dom.window.close()
})

const flush = () => new Promise<void>((r) => queueMicrotask(r))

describe('defineCustomElement()', () => {
  it('mounts the thunk on connectedCallback', () => {
    defineCustomElement(() => h('p', { class: 'g' }, ['hi']), 'tu-static')
    const el = dom.window.document.createElement('tu-static')
    dom.window.document.body.appendChild(el)
    expect(el.innerHTML).toBe('<p class="g">hi</p>')
  })

  it('re-renders on cell mutation while connected', async () => {
    const count = new Signal.State(0)
    defineCustomElement(() => h('p', {}, [`count = ${count.get()}`]), 'tu-counter')
    const el = dom.window.document.createElement('tu-counter')
    dom.window.document.body.appendChild(el)
    expect(el.textContent).toBe('count = 0')

    count.set(7)
    await flush()
    expect(el.textContent).toBe('count = 7')
  })

  it('stops the reactive subscription on disconnectedCallback', async () => {
    const count = new Signal.State(0)
    let renderCount = 0
    defineCustomElement(
      () => {
        renderCount++
        return h('p', {}, [`${count.get()}`])
      },
      'tu-disconnect'
    )
    const el = dom.window.document.createElement('tu-disconnect')
    dom.window.document.body.appendChild(el)
    expect(renderCount).toBe(1)

    el.remove()
    const before = renderCount
    count.set(99)
    await flush()
    // No re-render after disconnect.
    expect(renderCount).toBe(before)
  })

  it('throws when customElements is unavailable', () => {
    const original = (globalThis as unknown as { customElements?: unknown }).customElements
    ;(globalThis as unknown as { customElements?: unknown }).customElements = undefined
    expect(() =>
      defineCustomElement(() => h('p', {}, ['x']), 'tu-no-ce')
    ).toThrow(/requires a browser-like environment/)
    ;(globalThis as unknown as { customElements?: unknown }).customElements = original
  })
})
