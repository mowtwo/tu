// M4 V1 demo: server-side render Counter.tu to an HTML string, ship it
// into a fresh jsdom document, then call hydrate() to ADOPT that DOM —
// no createElement on the first frame — and verify identity preservation
// + event listener wiring + post-hydration patchChildren.
import { compile } from '@tu-lang/compiler'
import { hydrate, renderToString } from '@tu-lang/runtime'
import { JSDOM } from 'jsdom'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const sourcePath = resolve(__dirname, 'Counter.tu')
const outPath = resolve(__dirname, 'dist', 'Counter.mjs')

const compiled = compile(readFileSync(sourcePath, 'utf-8'))
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, compiled)

// ─── Step 1: server-side render ─────────────────────────────────────────────
// On the server we don't need jsdom — renderToString is pure ESM.
const serverMod = await import(pathToFileURL(outPath).href)
const ssrHtml = renderToString(serverMod.SsrCounter())

console.log('--- SSR HTML (server-side, no DOM) ---')
console.log(ssrHtml)

// ─── Step 2: ship it into a fresh client document ──────────────────────────
// In production this would be the browser parsing the response. Here jsdom
// stands in.
const dom = new JSDOM(`<!doctype html><html><body><div id="app">${ssrHtml}</div></body></html>`)
globalThis.document = dom.window.document
globalThis.Element = dom.window.Element
globalThis.Node = dom.window.Node
globalThis.Event = dom.window.Event

// Re-import the compiled module in this jsdom-installed environment so the
// runtime's browser code paths bind to the correct `document`. Note: the
// SERVER cell state is independent of the CLIENT cell state because each
// `import()` creates its own module instance — that's what real browsers
// do too. The server's role is only to stamp out HTML.
const clientMod = await import(`${pathToFileURL(outPath).href}?clientCopy=1`)

const root = dom.window.document.getElementById('app')
const ssrButtonRefs = Array.from(root.querySelectorAll('button'))
console.log('\n--- pre-hydrate root.innerHTML ---')
console.log(root.innerHTML)

// ─── Step 3: hydrate ───────────────────────────────────────────────────────
const stop = hydrate(() => clientMod.SsrCounter(), root)

const postHydrateButtons = Array.from(root.querySelectorAll('button'))
const sameButtons =
  postHydrateButtons.length === ssrButtonRefs.length &&
  postHydrateButtons.every((b, i) => b === ssrButtonRefs[i])

console.log('\n--- post-hydrate identity check ---')
console.log(`  same button DOM nodes: ${sameButtons}`)

// ─── Step 4: drive interactivity ───────────────────────────────────────────
postHydrateButtons[1].dispatchEvent(new dom.window.Event('click')) // +
postHydrateButtons[1].dispatchEvent(new dom.window.Event('click')) // +
postHydrateButtons[1].dispatchEvent(new dom.window.Event('click')) // +
postHydrateButtons[0].dispatchEvent(new dom.window.Event('click')) // −

await new Promise((r) => queueMicrotask(r))

console.log('\n--- after 3×inc + 1×dec ---')
console.log(root.innerHTML)
console.log(`  client count.get()   = ${clientMod.count.get()}`)
console.log(`  client doubled.get() = ${clientMod.doubled.get()}`)

stop()
