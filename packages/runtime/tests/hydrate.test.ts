import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { h, hydrate, renderToString, Signal } from '../src/index.js'

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

function ssrInto(container: Element, vnode: ReturnType<typeof h>): void {
  container.innerHTML = renderToString(vnode)
}

describe('hydrate() — adopt SSR output without rebuilding DOM', () => {
  it('preserves the original element identity (no createElement) on first render', () => {
    const root = dom.window.document.getElementById('root')!
    ssrInto(root, h('p', { class: 'g' }, ['hi']))
    const ssrP = root.querySelector('p')!

    hydrate(() => h('p', { class: 'g' }, ['hi']), root)

    // Same element instance, not a re-created one.
    expect(root.querySelector('p')).toBe(ssrP)
    expect(root.innerHTML).toBe('<p class="g">hi</p>')
  })

  it('attaches event listeners that SSR could not serialize', () => {
    const root = dom.window.document.getElementById('root')!
    ssrInto(root, h('button', {}, ['click']))
    const ssrButton = root.querySelector('button')!

    const onClick = vi.fn()
    hydrate(() => h('button', { onClick }, ['click']), root)

    expect(root.querySelector('button')).toBe(ssrButton)
    ssrButton.dispatchEvent(new dom.window.Event('click'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('subsequent cell mutation runs the normal patchChildren diff', async () => {
    const count = new Signal.State(0)
    const root = dom.window.document.getElementById('root')!
    // Server-side: first frame.
    ssrInto(root, h('p', {}, [`count = ${count.get()}`]))
    const ssrP = root.querySelector('p')!

    hydrate(() => h('p', {}, [`count = ${count.get()}`]), root)

    count.set(1)
    await flush()

    // Same `<p>`, just text content updated.
    expect(root.querySelector('p')).toBe(ssrP)
    expect(ssrP.textContent).toBe('count = 1')
  })

  it('skips incidental whitespace text nodes between elements', () => {
    const root = dom.window.document.getElementById('root')!
    // Pretty-printed HTML has whitespace between sibling tags. Browsers
    // (and jsdom) parse these as Text nodes — hydrate should ignore them.
    root.innerHTML = '\n  <p>a</p>\n  <p>b</p>\n  '
    const [p1, p2] = Array.from(root.querySelectorAll('p'))

    hydrate(() => [h('p', {}, ['a']), h('p', {}, ['b'])], root)

    expect(root.querySelector('p:nth-of-type(1)')).toBe(p1)
    expect(root.querySelector('p:nth-of-type(2)')).toBe(p2)
  })

  it('warns and falls back to materializing on a tag mismatch', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const root = dom.window.document.getElementById('root')!
    ssrInto(root, h('span', {}, ['oops']))

    hydrate(() => h('div', {}, ['expected']), root)

    expect(warn).toHaveBeenCalled()
    expect(warn.mock.calls[0]![0]).toMatch(/hydration mismatch/)
    // Final DOM holds the <div> the thunk asked for.
    expect(root.querySelector('div')?.textContent).toBe('expected')
    warn.mockRestore()
  })

  it('sets DOM properties that SSR can only encode as attributes (input value)', () => {
    const root = dom.window.document.getElementById('root')!
    ssrInto(root, h('input', { value: 'preset' }))
    const ssrInput = root.querySelector('input')! as unknown as HTMLInputElement
    // SSR set the attribute, but the live `.value` property is empty until
    // we hydrate.
    expect(ssrInput.getAttribute('value')).toBe('preset')

    hydrate(() => h('input', { value: 'preset' }), root)

    expect(ssrInput.value).toBe('preset')
  })

  it('splits a SSR-coalesced text node when adjacent vnode children share it', async () => {
    // Two adjacent text children — `"count = "` + `0` — fuse into ONE Text
    // node when SSR concatenates them. Hydrate must split so each Tu Instance
    // owns its own text node, otherwise a later cell mutation can't update
    // the numeric tail in place.
    const count = new Signal.State(0)
    const root = dom.window.document.getElementById('root')!
    const ssrVNode = h('p', {}, [`count = `, count.get()])
    ssrInto(root, ssrVNode)
    const ssrP = root.querySelector('p')!
    // Confirm pre-condition: SSR really did fuse them.
    expect(ssrP.childNodes.length).toBe(1)
    expect(ssrP.firstChild?.nodeValue).toBe('count = 0')

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    hydrate(() => h('p', {}, [`count = `, count.get()]), root)
    // Hydrate split it into the head Text + tail Text.
    expect(ssrP.childNodes.length).toBe(2)
    expect(ssrP.childNodes[0]?.nodeValue).toBe('count = ')
    expect(ssrP.childNodes[1]?.nodeValue).toBe('0')
    expect(warn).not.toHaveBeenCalled() // split is the spec'd path, not a warning
    warn.mockRestore()

    count.set(7)
    await flush()
    // After the cell mutation, only the tail text node updates — the head
    // text node's identity is preserved (no re-render of the static prefix).
    expect(ssrP.childNodes[0]?.nodeValue).toBe('count = ')
    expect(ssrP.childNodes[1]?.nodeValue).toBe('7')
  })

  it('stop() removes the hydrated subtree from the container', () => {
    const root = dom.window.document.getElementById('root')!
    ssrInto(root, h('p', {}, ['hi']))

    const stop = hydrate(() => h('p', {}, ['hi']), root)
    expect(root.querySelector('p')).not.toBeNull()

    stop()
    expect(root.querySelector('p')).toBeNull()
  })
})
