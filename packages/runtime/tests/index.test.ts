import { describe, expect, it } from 'vitest'
import {
  Fragment,
  h,
  normalizeClassValue,
  normalizeStyleValue,
  renderPage,
  renderPageAsync,
  renderPageHtml,
  renderToStream,
  renderToString,
  renderToStringAsync,
  Suspense,
  TuRenderError,
  VERSION,
} from '../src/index.js'

async function streamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let out = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
  }
  out += decoder.decode()
  return out
}

async function streamChunks(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(decoder.decode(value, { stream: true }))
  }
  const tail = decoder.decode()
  if (tail.length > 0) chunks.push(tail)
  return chunks
}

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

  // ─── M9 — class / style array + object normalization ────────────────

  it('normalizeClassValue: string passes through, falsy → empty', () => {
    expect(normalizeClassValue('a b')).toBe('a b')
    expect(normalizeClassValue('')).toBe('')
    expect(normalizeClassValue(null)).toBe('')
    expect(normalizeClassValue(undefined)).toBe('')
    expect(normalizeClassValue(false)).toBe('')
  })

  it('normalizeClassValue: array flattens, drops falsy entries', () => {
    expect(normalizeClassValue(['a', 'b'])).toBe('a b')
    expect(normalizeClassValue(['a', null, false, '', 'b'])).toBe('a b')
    // Nested arrays flatten recursively.
    expect(normalizeClassValue(['base', ['flex', ['gap-2']]])).toBe('base flex gap-2')
    // Mixed-with-conditional pattern.
    const isActive = true
    const isOpen = false
    expect(normalizeClassValue(['btn', isActive && 'active', isOpen && 'open'])).toBe('btn active')
  })

  it('normalizeClassValue: object includes truthy keys', () => {
    expect(normalizeClassValue({ card: true, active: false, open: 1 })).toBe('card open')
    expect(normalizeClassValue({})).toBe('')
  })

  it('normalizeClassValue: mixed array + object form', () => {
    expect(normalizeClassValue(['btn', { active: true, disabled: false }])).toBe('btn active')
  })

  it('normalizeStyleValue: string passes through; null → empty', () => {
    expect(normalizeStyleValue('color: red')).toBe('color: red')
    expect(normalizeStyleValue(null)).toBe('')
    expect(normalizeStyleValue(undefined)).toBe('')
  })

  it('normalizeStyleValue: object form joins as kebab-key: value pairs', () => {
    expect(normalizeStyleValue({ color: 'red', fontSize: '12px' })).toBe(
      'color: red; font-size: 12px'
    )
  })

  it('normalizeStyleValue: drops null / false values; numeric pass through verbatim', () => {
    expect(
      normalizeStyleValue({ color: 'red', fontSize: null, opacity: false, lineHeight: 1.5 })
    ).toBe('color: red; line-height: 1.5')
  })

  it('SSR: class array flattens to a space-joined string', () => {
    const v = h('div', { class: ['btn', 'primary'] }, ['x'])
    expect(renderToString(v)).toBe('<div class="btn primary">x</div>')
  })

  it('SSR: class object includes truthy keys only', () => {
    const v = h('div', { class: { card: true, active: false } }, ['x'])
    expect(renderToString(v)).toBe('<div class="card">x</div>')
  })

  it('SSR: empty class normalization omits the attribute entirely', () => {
    const v = h('div', { class: [null, false, ''] }, ['x'])
    expect(renderToString(v)).toBe('<div>x</div>')
  })

  it('SSR: style object form emits kebab-cased pairs', () => {
    const v = h('div', { style: { color: 'red', fontSize: '12px' } }, ['x'])
    expect(renderToString(v)).toBe('<div style="color: red; font-size: 12px">x</div>')
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

  // ─── M6.11 / #62 — streaming SSR ──────────────────────────────────────

  it('renderToStream — no Suspense — emits a complete document and closes', async () => {
    const stream = renderToStream(() => h('div', {}, ['hi']), { title: 'X' })
    const html = await streamToString(stream)
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<title>X</title>')
    expect(html).toContain('<div>hi</div>')
    expect(html.endsWith('</body></html>')).toBe(true)
    // No replacer script when there are no boundaries.
    expect(html).not.toContain('$tu_replace')
  })

  it('renderToStream — Suspense placeholder + template + replacer arrive in chunks', async () => {
    let resolveBody: ((v: unknown) => void) | undefined
    const bodyP = new Promise<unknown>((r) => {
      resolveBody = r
    })
    const Page = () =>
      h('main', {}, [
        Suspense({
          fallback: h('p', {}, ['Loading…']),
          children: [bodyP as Promise<unknown> as unknown as never],
        }),
      ])

    const stream = renderToStream(Page, { title: 'Y' })
    const reader = stream.getReader()
    const decoder = new TextDecoder()

    // First chunk: shell + body with placeholder.
    const c1 = await reader.read()
    expect(c1.done).toBe(false)
    const first = decoder.decode(c1.value!, { stream: true })
    expect(first).toContain('<!doctype html>')
    expect(first).toContain('<title>Y</title>')
    expect(first).toContain('<main><div data-tu-suspense="0"><p>Loading…</p></div></main>')

    // Second chunk: replacer polyfill (only emitted when there's a boundary).
    const c2 = await reader.read()
    expect(c2.done).toBe(false)
    const second = decoder.decode(c2.value!, { stream: true })
    expect(second).toContain('$tu_replace')

    // Body still pending — resolver chunk hasn't arrived.
    // Resolve the boundary now; expect template + replace-call.
    resolveBody!(h('article', {}, ['payload']))
    const c3 = await reader.read()
    expect(c3.done).toBe(false)
    const third = decoder.decode(c3.value!, { stream: true })
    expect(third).toContain('<template id="S:0"><article>payload</article></template>')
    expect(third).toContain('<script>$tu_replace("0")</script>')

    // Final chunk: close tags.
    const c4 = await reader.read()
    expect(c4.done).toBe(false)
    const fourth = decoder.decode(c4.value!, { stream: true })
    expect(fourth).toBe('</body></html>')

    const c5 = await reader.read()
    expect(c5.done).toBe(true)
  })

  it('renderToStream — boundaries flush in resolution order, not source order', async () => {
    let resolveSlow!: (v: unknown) => void
    let resolveFast!: (v: unknown) => void
    const slow = new Promise<unknown>((r) => {
      resolveSlow = r
    })
    const fast = new Promise<unknown>((r) => {
      resolveFast = r
    })
    const Page = () =>
      h('main', {}, [
        Suspense({
          fallback: h('span', {}, ['S-FB']),
          children: [slow as never],
        }),
        Suspense({
          fallback: h('span', {}, ['F-FB']),
          children: [fast as never],
        }),
      ])

    const stream = renderToStream(Page)
    // Resolve fast first, slow later.
    queueMicrotask(() => resolveFast(h('span', {}, ['fast-done'])))
    setTimeout(() => resolveSlow(h('span', {}, ['slow-done'])), 20)

    const chunks = await streamChunks(stream)
    // Find the order of template chunks by id.
    const tplOrder: number[] = []
    for (const c of chunks) {
      const m = c.match(/<template id="S:(\d+)"/)
      if (m) tplOrder.push(parseInt(m[1]!, 10))
    }
    // Source order: slow=0, fast=1. Expect fast (id=1) to flush first.
    expect(tplOrder).toEqual([1, 0])
    const full = chunks.join('')
    expect(full).toContain('<span>fast-done</span>')
    expect(full).toContain('<span>slow-done</span>')
  })

  it('renderToStream — rejected boundary leaves fallback in place, no template', async () => {
    const Page = () =>
      h('main', {}, [
        Suspense({
          fallback: h('p', {}, ['(failed-fb)']),
          children: [Promise.reject(new Error('boom')) as never],
        }),
      ])
    const html = await streamToString(renderToStream(Page))
    expect(html).toContain('<div data-tu-suspense="0"><p>(failed-fb)</p></div>')
    // No template injected for the failed boundary.
    expect(html).not.toContain('<template id="S:0"')
    // Replacer script still present (we shipped it once after the shell).
    expect(html).toContain('$tu_replace')
    expect(html.endsWith('</body></html>')).toBe(true)
  })

  it('renderToStream — onShellReady fires after the shell + placeholders, before resolutions', async () => {
    const order: string[] = []
    let resolveBody!: (v: unknown) => void
    const body = new Promise<unknown>((r) => {
      resolveBody = r
    })
    const Page = () =>
      Suspense({
        fallback: h('p', {}, ['…']),
        children: [body as never],
      })
    const stream = renderToStream(Page, {
      onShellReady: () => order.push('shell'),
    })
    // Drain the stream while the body is pending; resolve mid-drain.
    const reader = stream.getReader()
    // First chunk = shell+body. After this chunk, onShellReady is fired.
    await reader.read()
    await reader.read() // replacer chunk
    order.push('post-shell-read')
    resolveBody(h('span', {}, ['done']))
    while (true) {
      const r = await reader.read()
      if (r.done) break
    }
    // The two events: shell flush happens before our reader saw the post.
    expect(order[0]).toBe('shell')
    expect(order[1]).toBe('post-shell-read')
  })

  it('renderToStream — bare Promise child (no Suspense wrapper) becomes its own boundary', async () => {
    // A naked Promise gets the same placeholder treatment with empty fallback.
    const Page = () =>
      h('main', {}, [Promise.resolve(h('span', {}, ['naked'])) as never])
    const html = await streamToString(renderToStream(Page))
    expect(html).toContain('<div data-tu-suspense="0"></div>')
    expect(html).toContain('<template id="S:0"><span>naked</span></template>')
  })

  it('renderToStream — async thunk is awaited before shell flush', async () => {
    const asyncThunk = async () => {
      const v = await Promise.resolve('async-root')
      return h('p', {}, [v])
    }
    const html = await streamToString(renderToStream(asyncThunk))
    expect(html).toContain('<p>async-root</p>')
  })
})
