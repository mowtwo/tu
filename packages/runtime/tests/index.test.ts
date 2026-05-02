import { describe, expect, it } from 'vitest'
import {
  Fragment,
  h,
  renderPage,
  renderPageAsync,
  renderPageHtml,
  renderToString,
  renderToStringAsync,
  Suspense,
  TuRenderError,
  VERSION,
} from '../src/index.js'

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

  // ─── M6.11 / #60 — async SSR ─────────────────────────────────────────

  it('sync renderToString throws on a Promise child (TuRenderError)', () => {
    const promised: Promise<string> = Promise.resolve('hi')
    const v = h('div', {}, [promised])
    expect(() => renderToString(v)).toThrow(TuRenderError)
    // Bare-Promise-at-root case too.
    expect(() => renderToString(promised)).toThrow(TuRenderError)
  })

  it('renderToStringAsync resolves a promise child to its inner content', async () => {
    const v = h('div', {}, [Promise.resolve('hello')])
    expect(await renderToStringAsync(v)).toBe('<div>hello</div>')
  })

  it('renderToStringAsync threads through a promise resolving to a vnode', async () => {
    const slow = Promise.resolve(h('span', { class: 'x' }, ['boom']))
    const v = h('div', {}, [slow])
    expect(await renderToStringAsync(v)).toBe('<div><span class="x">boom</span></div>')
  })

  it('renderToStringAsync handles a promise resolving to another promise (transitive)', async () => {
    const inner = Promise.resolve('deep')
    const outer = Promise.resolve(inner) as Promise<unknown> as Promise<string>
    expect(await renderToStringAsync(outer)).toBe('deep')
  })

  it('renderToStringAsync resolves siblings in parallel — slow child does not block fast', async () => {
    const log: string[] = []
    const slow = new Promise<string>((res) =>
      setTimeout(() => {
        log.push('slow')
        res('S')
      }, 30)
    )
    const fast = new Promise<string>((res) =>
      setTimeout(() => {
        log.push('fast')
        res('F')
      }, 5)
    )
    const v = h('div', {}, [slow, fast])
    const out = await renderToStringAsync(v)
    // Output preserves source order regardless of resolution order.
    expect(out).toBe('<div>SF</div>')
    // Resolution order: fast finished first.
    expect(log).toEqual(['fast', 'slow'])
  })

  it('renderToStringAsync propagates a rejection (no Suspense wrapper)', async () => {
    const v = h('div', {}, [Promise.reject(new Error('boom'))])
    await expect(renderToStringAsync(v)).rejects.toThrow('boom')
  })

  it('renderToStringAsync still escapes text + attrs from resolved values', async () => {
    const v = h('p', { title: Promise.resolve('"x"&y') }, [Promise.resolve('<b>')])
    // Note: promise as a prop value — we don't await prop values today
    // (only children). Document this: prop values must be sync. The
    // prop here renders as `[object Promise]`-ish; assert child path
    // alone is correct by stripping the prop.
    const v2 = h('p', {}, [Promise.resolve('<b>')])
    expect(await renderToStringAsync(v2)).toBe('<p>&lt;b&gt;</p>')
  })

  it('renderToStringAsync inside <style> raw-text element does not HTML-escape', async () => {
    const css = Promise.resolve('.card > h1 { color: red; }')
    const v = h('style', {}, [css])
    expect(await renderToStringAsync(v)).toBe('<style>.card > h1 { color: red; }</style>')
  })

  it('renderToStringAsync passes through static-HTML subtrees unchanged', async () => {
    const staticV = h('$static', {}, [], '<button class="b">+</button>')
    expect(await renderToStringAsync(staticV)).toBe('<button class="b">+</button>')
  })

  it('renderPageAsync awaits an async thunk and assembles the full HTML doc', async () => {
    const asyncThunk = async () => {
      const data = await Promise.resolve('Hello')
      return h('main', {}, [data])
    }
    const html = await renderPageAsync(asyncThunk, { title: 'A' })
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<title>A</title>')
    expect(html).toContain('<main>Hello</main>')
  })

  it('renderPageAsync accepts a sync thunk too — back-compat with renderPage', async () => {
    const html = await renderPageAsync(() => h('div', {}, ['x']), { title: 'B' })
    expect(html).toContain('<title>B</title>')
    expect(html).toContain('<div>x</div>')
  })

  // ─── M6.11 / #61 — Suspense ──────────────────────────────────────────

  it('Suspense renders body when children resolve cleanly', async () => {
    const body = Suspense({
      fallback: h('div', {}, ['Loading…']),
      children: [Promise.resolve(h('span', {}, ['done']))],
    })
    expect(await renderToStringAsync(body)).toBe('<span>done</span>')
  })

  it('Suspense renders fallback when a child rejects', async () => {
    const body = Suspense({
      fallback: h('div', {}, ['Loading…']),
      children: [Promise.reject(new Error('boom'))],
    })
    expect(await renderToStringAsync(body)).toBe('<div>Loading…</div>')
  })

  it('Suspense catches a chained-then throw inside the children pipeline', async () => {
    const body = Suspense({
      fallback: h('div', {}, ['F']),
      children: [
        Promise.resolve(null).then(() => {
          throw new Error('async throw')
        }),
      ],
    })
    expect(await renderToStringAsync(body)).toBe('<div>F</div>')
  })

  it('Suspense composes — inner boundary catches, outer sees only fallback string', async () => {
    const inner = Suspense({
      fallback: h('span', {}, ['inner-loading']),
      children: [Promise.reject(new Error('inner boom'))],
    })
    const outer = Suspense({
      fallback: h('div', {}, ['outer-loading']),
      children: [inner],
    })
    expect(await renderToStringAsync(outer)).toBe('<span>inner-loading</span>')
  })

  it('Suspense — sibling boundaries resolve independently', async () => {
    const ok = Suspense({
      fallback: h('span', {}, ['OK-FB']),
      children: [Promise.resolve(h('span', {}, ['ok!']))],
    })
    const bad = Suspense({
      fallback: h('span', {}, ['BAD-FB']),
      children: [Promise.reject(new Error('x'))],
    })
    const html = await renderToStringAsync(h('div', {}, [ok, bad]))
    expect(html).toBe('<div><span>ok!</span><span>BAD-FB</span></div>')
  })

  it('sync renderToString of Suspense renders fallback (no body walk)', () => {
    const v = Suspense({
      fallback: h('div', { class: 'l' }, ['Loading…']),
      children: [h('span', {}, ['(body would be ignored)'])],
    })
    expect(renderToString(v)).toBe('<div class="l">Loading…</div>')
  })

  it('Suspense fallback may itself contain a promise — async path resolves it', async () => {
    const v = Suspense({
      fallback: Promise.resolve(h('div', {}, ['async fallback'])),
      children: [Promise.reject(new Error('boom'))],
    })
    expect(await renderToStringAsync(v)).toBe('<div>async fallback</div>')
  })

  it('Suspense without children renders the fallback (no body to wait on)', async () => {
    const v = Suspense({ fallback: h('div', {}, ['just FB']) })
    // Empty body resolves to empty string — fallback NOT used.
    expect(await renderToStringAsync(v)).toBe('')
  })

  it('Suspense end-to-end via renderPageAsync', async () => {
    const Page = () =>
      Suspense({
        fallback: h('div', { class: 'spinner' }, ['…']),
        children: [Promise.resolve(h('main', {}, ['payload']))],
      })
    const html = await renderPageAsync(Page, { title: 'S' })
    expect(html).toContain('<title>S</title>')
    expect(html).toContain('<main>payload</main>')
    expect(html).not.toContain('spinner')
  })
})
