import { describe, expect, it } from 'vitest'
import { Fragment, h, renderPage, renderPageHtml, renderToString, VERSION } from '../src/index.js'

describe('@tu-lang/runtime', () => {
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

  it('renderToString flattens array children (for-loop output)', () => {
    const v = h('ul', {}, [[h('li', {}, ['a']), h('li', {}, ['b'])]])
    expect(renderToString(v)).toBe('<ul><li>a</li><li>b</li></ul>')
  })

  it('renderToString flattens nested arrays', () => {
    expect(renderToString([['a', 'b'], 'c'])).toBe('abc')
  })

  it('does not HTML-escape text inside <style> (raw-text element)', () => {
    const css = '.card > h1 { color: red; } /* x>y */'
    expect(renderToString(h('style', {}, [css]))).toBe(`<style>${css}</style>`)
  })

  it('does not HTML-escape text inside <script> (raw-text element)', () => {
    const js = 'if (x < 10 && y > 0) console.log("ok")'
    expect(renderToString(h('script', {}, [js]))).toBe(`<script>${js}</script>`)
  })

  it('renderToString skips function-typed props (event handlers have no SSR rep)', () => {
    const v = h('button', { onClick: () => {}, class: 'b' }, ['+'])
    expect(renderToString(v)).toBe('<button class="b">+</button>')
  })

  it('Fragment passes its children through; renderer flattens', () => {
    // Tu's component path emits `Fragment([a, b, c])` for `Fragment { a b c }`.
    // The runtime function returns the array — `renderToString`'s array
    // flatten then splices them as siblings.
    const result = Fragment([h('p', {}, ['a']), h('p', {}, ['b'])])
    expect(renderToString(result)).toBe('<p>a</p><p>b</p>')
  })

  // ─── M6.2 — renderPage (full HTML document) ─────────────────────────

  it('renderPage wraps the body in a complete HTML5 doctype + html scaffold', () => {
    const html = renderPage(() => h('div', {}, ['app']))
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('<meta charset="utf-8">')
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1.0">')
    expect(html).toContain('<body>')
    expect(html).toContain('<div>app</div>')
    expect(html.endsWith('</body></html>')).toBe(true)
  })

  it('renderPage injects title + extra meta + stylesheet links', () => {
    const html = renderPage(() => h('main', {}, []), {
      title: 'My Tu App',
      meta: { description: 'A reactive UI built with Tu' },
      links: [{ rel: 'stylesheet', href: '/assets/app.css' }],
    })
    expect(html).toContain('<title>My Tu App</title>')
    expect(html).toContain('<meta name="description" content="A reactive UI built with Tu">')
    expect(html).toContain('<link rel="stylesheet" href="/assets/app.css">')
  })

  it('renderPage emits scripts with type/defer/async/inline body', () => {
    const html = renderPage(() => h('div', {}, []), {
      scripts: [
        { src: '/client.js', type: 'module' },
        { src: '/legacy.js', defer: true },
        { body: 'console.log("inline")', type: 'module' },
      ],
    })
    expect(html).toContain('<script type="module" src="/client.js"></script>')
    expect(html).toContain('<script src="/legacy.js" defer></script>')
    expect(html).toContain('<script type="module">console.log("inline")</script>')
  })

  it('renderPage escapes user-supplied title + meta values', () => {
    const html = renderPage(() => h('div', {}, []), {
      title: '<bad>"&y',
      meta: { description: '<x' },
    })
    expect(html).toContain('<title>&lt;bad&gt;"&amp;y</title>')
    expect(html).toContain('<meta name="description" content="&lt;x">')
  })

  it('renderPage carries a body class + an inline state-hydration script', () => {
    const html = renderPage(() => h('div', {}, []), {
      bodyClass: 'theme-dark',
      inlineScript: 'window.__INITIAL__ = {"count":0}',
    })
    expect(html).toContain('<body class="theme-dark">')
    expect(html).toContain('<script>window.__INITIAL__ = {"count":0}</script></body>')
  })

  it('renderPageHtml accepts pre-rendered body — useful for routing pipelines', () => {
    const body = renderToString(h('p', {}, ['hi']))
    const html = renderPageHtml(body, { title: 'pre-rendered' })
    expect(html).toContain('<title>pre-rendered</title>')
    expect(html).toContain('<p>hi</p>')
  })

  it('renderPage charset can be overridden via meta map', () => {
    const html = renderPage(() => h('div', {}, []), { meta: { charset: 'utf-16' } })
    expect(html).toContain('<meta charset="utf-16">')
    // Default charset isn't emitted twice.
    expect(html.match(/<meta charset=/g)).toHaveLength(1)
  })
})
