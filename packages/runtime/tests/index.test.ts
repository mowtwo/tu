import { describe, expect, it } from 'vitest'
import { h, renderToString, VERSION } from '../src/index.js'

describe('@tu/runtime', () => {
  it('exposes a version', () => {
    expect(VERSION).toBe('0.0.0')
  })

  it('h() builds a vnode', () => {
    const node = h('div', { class: 'x' }, ['hi'])
    expect(node).toEqual({ tag: 'div', props: { class: 'x' }, children: ['hi'] })
  })

  it('renderToString returns text for primitives', () => {
    expect(renderToString('hi')).toBe('hi')
    expect(renderToString(42)).toBe('42')
    expect(renderToString(null)).toBe('')
    expect(renderToString(undefined)).toBe('')
  })

  it('renderToString renders a vnode with props and children', () => {
    const v = h('div', { class: 'g' }, [h('span', {}, ['hello'])])
    expect(renderToString(v)).toBe('<div class="g"><span>hello</span></div>')
  })

  it('renderToString escapes text content', () => {
    expect(renderToString(h('p', {}, ['<b>bold</b>']))).toBe('<p>&lt;b&gt;bold&lt;/b&gt;</p>')
  })

  it('renderToString escapes attribute values', () => {
    expect(renderToString(h('a', { href: '"x"&y' }, []))).toBe('<a href="&quot;x&quot;&amp;y"></a>')
  })

  it('renderToString skips false / null / undefined props', () => {
    expect(renderToString(h('div', { hidden: false, x: null, y: undefined, z: true }, []))).toBe(
      '<div z></div>'
    )
  })

  it('renderToString emits self-closing void elements', () => {
    expect(renderToString(h('br', {}, []))).toBe('<br>')
    expect(renderToString(h('img', { src: '/a.png', alt: 'a' }, []))).toBe(
      '<img src="/a.png" alt="a">'
    )
  })

  it('renderToString concatenates mixed children', () => {
    expect(renderToString(h('h1', {}, ['Hello, ', 'World', '!']))).toBe('<h1>Hello, World!</h1>')
  })
})
