import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { h, Signal } from '@tu-lang/runtime'
import { mount } from '../src/index.js'

let dom: JSDOM
beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  ;(globalThis as unknown as { document: Document }).document = dom.window.document
  ;(globalThis as unknown as { Element: typeof Element }).Element = dom.window.Element as never
  ;(globalThis as unknown as { Node: typeof Node }).Node = dom.window.Node as never
  ;(globalThis as unknown as { Event: typeof Event }).Event = dom.window.Event as never
  ;(globalThis as unknown as { HTMLInputElement: typeof HTMLInputElement }).HTMLInputElement =
    dom.window.HTMLInputElement as never
})
afterEach(() => {
  dom.window.close()
})

const flush = () => new Promise<void>((r) => queueMicrotask(r))
const root = () => dom.window.document.getElementById('root')!

describe('keyed diff — DOM identity', () => {
  it('reuses the same element across re-renders when only a child text changes', async () => {
    const text = new Signal.State('a')
    mount(() => h('p', { id: 'x' }, [text.get()]), root())
    const before = dom.window.document.getElementById('x')!
    text.set('b')
    await flush()
    const after = dom.window.document.getElementById('x')!
    expect(after).toBe(before)
    expect(after.textContent).toBe('b')
  })

  it('replaces the element when the tag changes', async () => {
    const tag = new Signal.State<'p' | 'span'>('p')
    mount(() => h(tag.get(), { id: 'x' }, ['hi']), root())
    const before = dom.window.document.getElementById('x')!
    expect(before.tagName).toBe('P')
    tag.set('span')
    await flush()
    const after = dom.window.document.getElementById('x')!
    expect(after).not.toBe(before)
    expect(after.tagName).toBe('SPAN')
  })

  it('updates an attribute in place without recreating the element', async () => {
    const cls = new Signal.State('a')
    mount(() => h('div', { id: 'x', class: cls.get() }, []), root())
    const before = dom.window.document.getElementById('x')!
    expect(before.getAttribute('class')).toBe('a')
    cls.set('b')
    await flush()
    const after = dom.window.document.getElementById('x')!
    expect(after).toBe(before)
    expect(after.getAttribute('class')).toBe('b')
  })

  it('removes an attribute when the prop becomes null/false', async () => {
    const flag = new Signal.State<string | null>('on')
    mount(() => h('div', { id: 'x', 'data-flag': flag.get() }, []), root())
    expect(root().firstChild!).toHaveProperty('attributes')
    expect(dom.window.document.getElementById('x')!.getAttribute('data-flag')).toBe('on')
    flag.set(null)
    await flush()
    expect(dom.window.document.getElementById('x')!.hasAttribute('data-flag')).toBe(false)
  })
})

describe('keyed diff — handlers', () => {
  it('rebinds an event listener when the handler reference changes', async () => {
    const which = new Signal.State<'a' | 'b'>('a')
    let aCalls = 0
    let bCalls = 0
    const handlerA = () => {
      aCalls++
    }
    const handlerB = () => {
      bCalls++
    }
    mount(
      () =>
        h(
          'button',
          { id: 'btn', onClick: which.get() === 'a' ? handlerA : handlerB },
          ['click me']
        ),
      root()
    )
    const btn = dom.window.document.getElementById('btn')!
    btn.dispatchEvent(new dom.window.Event('click'))
    expect(aCalls).toBe(1)
    expect(bCalls).toBe(0)
    which.set('b')
    await flush()
    btn.dispatchEvent(new dom.window.Event('click'))
    expect(aCalls).toBe(1) // handler A no longer attached
    expect(bCalls).toBe(1)
  })

  it('does not rebind when the handler reference is identical across renders', async () => {
    let removeCalls = 0
    let addCalls = 0
    const tick = new Signal.State(0)
    // Use a single stable handler reference.
    const stable = () => {}
    mount(() => h('button', { id: 'btn', onClick: stable }, [String(tick.get())]), root())
    const btn = dom.window.document.getElementById('btn')!
    const origRemove = btn.removeEventListener.bind(btn)
    const origAdd = btn.addEventListener.bind(btn)
    btn.removeEventListener = ((...a: Parameters<typeof origRemove>) => {
      removeCalls++
      return origRemove(...a)
    }) as never
    btn.addEventListener = ((...a: Parameters<typeof origAdd>) => {
      addCalls++
      return origAdd(...a)
    }) as never
    tick.set(1)
    await flush()
    tick.set(2)
    await flush()
    expect(addCalls).toBe(0)
    expect(removeCalls).toBe(0)
  })
})

describe('keyed diff — focus + input value', () => {
  it('preserves focus on an input across an unrelated cell mutation', async () => {
    const counter = new Signal.State(0)
    mount(
      () =>
        h('div', {}, [
          h('input', { id: 'i', type: 'text' }, []),
          h('p', {}, ['count: ', counter.get()]),
        ]),
      root()
    )
    const input = dom.window.document.getElementById('i') as HTMLInputElement
    input.focus()
    expect(dom.window.document.activeElement).toBe(input)
    counter.set(1)
    await flush()
    counter.set(2)
    await flush()
    expect(dom.window.document.activeElement).toBe(input)
  })

  it('updates input.value as a DOM property (not just attribute) when value: changes', async () => {
    const v = new Signal.State('hello')
    mount(() => h('input', { id: 'i', value: v.get() }, []), root())
    const input = dom.window.document.getElementById('i') as HTMLInputElement
    expect(input.value).toBe('hello')
    v.set('world')
    await flush()
    expect(input.value).toBe('world')
  })
})

describe('keyed diff — list reorder by `key:`', () => {
  it('preserves DOM identity for keyed items across reorder', async () => {
    const items = new Signal.State([
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
      { id: 'c', text: 'C' },
    ])
    mount(
      () =>
        h(
          'ul',
          {},
          items.get().map((it) => h('li', { key: it.id, id: `li-${it.id}` }, [it.text]))
        ),
      root()
    )
    const before = {
      a: dom.window.document.getElementById('li-a')!,
      b: dom.window.document.getElementById('li-b')!,
      c: dom.window.document.getElementById('li-c')!,
    }
    items.set([
      { id: 'c', text: 'C' },
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ])
    await flush()
    const after = {
      a: dom.window.document.getElementById('li-a')!,
      b: dom.window.document.getElementById('li-b')!,
      c: dom.window.document.getElementById('li-c')!,
    }
    expect(after.a).toBe(before.a)
    expect(after.b).toBe(before.b)
    expect(after.c).toBe(before.c)
    const ul = root().firstChild as Element
    expect(ul.children[0]!.id).toBe('li-c')
    expect(ul.children[1]!.id).toBe('li-a')
    expect(ul.children[2]!.id).toBe('li-b')
  })

  it('inserts in the middle without recreating siblings', async () => {
    const items = new Signal.State([
      { id: 'a', text: 'A' },
      { id: 'c', text: 'C' },
    ])
    mount(
      () =>
        h(
          'ul',
          {},
          items.get().map((it) => h('li', { key: it.id, id: `li-${it.id}` }, [it.text]))
        ),
      root()
    )
    const beforeA = dom.window.document.getElementById('li-a')!
    const beforeC = dom.window.document.getElementById('li-c')!
    items.set([
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
      { id: 'c', text: 'C' },
    ])
    await flush()
    expect(dom.window.document.getElementById('li-a')!).toBe(beforeA)
    expect(dom.window.document.getElementById('li-c')!).toBe(beforeC)
    expect(dom.window.document.getElementById('li-b')).not.toBeNull()
    const ul = root().firstChild as Element
    expect([...ul.children].map((c) => c.id)).toEqual(['li-a', 'li-b', 'li-c'])
  })

  it('removes from the middle without recreating siblings', async () => {
    const items = new Signal.State([
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
      { id: 'c', text: 'C' },
    ])
    mount(
      () =>
        h(
          'ul',
          {},
          items.get().map((it) => h('li', { key: it.id, id: `li-${it.id}` }, [it.text]))
        ),
      root()
    )
    const beforeA = dom.window.document.getElementById('li-a')!
    const beforeC = dom.window.document.getElementById('li-c')!
    items.set([
      { id: 'a', text: 'A' },
      { id: 'c', text: 'C' },
    ])
    await flush()
    expect(dom.window.document.getElementById('li-a')!).toBe(beforeA)
    expect(dom.window.document.getElementById('li-c')!).toBe(beforeC)
    expect(dom.window.document.getElementById('li-b')).toBeNull()
  })

  it('M1.15: LIS pass moves only swapped endpoints, leaves the stable middle alone', async () => {
    // Old: [A B C D E]; new: [E B C D A] swaps A↔E. Items B, C, D form the
    // longest increasing subsequence by old-index; pre-LIS the simple
    // forward pass moved every item, now only A and E should move.
    const items = new Signal.State(['a', 'b', 'c', 'd', 'e'].map((id) => ({ id })))
    mount(
      () =>
        h(
          'ul',
          {},
          items.get().map((it) => h('li', { key: it.id, id: `li-${it.id}` }, []))
        ),
      root()
    )
    const before = ['a', 'b', 'c', 'd', 'e'].map(
      (id) => dom.window.document.getElementById(`li-${id}`)!
    )
    // Spy on the parent ul's insertBefore to count actual DOM moves.
    const ul = root().firstChild as Element
    const realInsertBefore = ul.insertBefore.bind(ul)
    let moveCount = 0
    ul.insertBefore = ((node: Node, ref: Node | null) => {
      moveCount++
      return realInsertBefore(node, ref)
    }) as typeof ul.insertBefore
    items.set([{ id: 'e' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'a' }])
    await flush()
    // Identities preserved across the swap.
    const after = ['a', 'b', 'c', 'd', 'e'].map(
      (id) => dom.window.document.getElementById(`li-${id}`)!
    )
    for (let i = 0; i < 5; i++) expect(after[i]).toBe(before[i])
    // Order in DOM matches the new logical order.
    expect([...ul.children].map((c) => c.id)).toEqual(['li-e', 'li-b', 'li-c', 'li-d', 'li-a'])
    // Pre-LIS this would be 4 moves; LIS reduces to exactly 2 (A and E).
    expect(moveCount).toBe(2)
  })
})
