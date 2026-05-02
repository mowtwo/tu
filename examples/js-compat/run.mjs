// Compile JsCompat.tu, execute the runDemo() entrypoint, and render the
// component to HTML — all in jsdom so the run is offline. Verifies that
// the JS/TS surface (template literals, optional chaining, regex,
// async/await, try/catch/finally, spread, ternary, external JS) compiles
// to runnable native JS.
import { compile } from '@tu-lang/compiler'
import { mount } from '@tu-lang/runtime'
import { JSDOM } from 'jsdom'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const sourcePath = resolve(__dirname, 'JsCompat.tu')
const outPath = resolve(__dirname, 'dist', 'JsCompat.mjs')

const compiled = compile(readFileSync(sourcePath, 'utf-8'))
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, compiled)

// Boot jsdom so DOM globals + performance.now() exist for the runtime
// and for the `external JS` shuffle helper.
const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>')
globalThis.document = dom.window.document
globalThis.Element = dom.window.Element
globalThis.Node = dom.window.Node
globalThis.Event = dom.window.Event

const mod = await import(pathToFileURL(outPath).href)

console.log('--- runDemo() ---')
const out = await mod.runDemo()
console.log('  initial label   :', out.initial)
console.log('  after toggle    :', out.afterToggle.map((t) => `${t.id}:${t.done ? '✔' : '·'}`).join(' '))
console.log('  after append    :', out.afterAppend.map((t) => `${t.id}:${t.title}`).join(' | '))
console.log('  after markAll   :', out.afterAllDone.every((t) => t.done) ? 'all done ✔' : 'still some open')
console.log('  shuffle summary :', out.shuffleSummary)
console.log('  slug checks     :', out.slugChecks.join(' / '))
console.log('  ok profile      :', JSON.stringify(out.okProfile))
console.log('  bad profile     :', JSON.stringify(out.badProfile))
console.log('  finally log     :', out.finalLog.join(' | '))

console.log('\n--- mounted DOM (JsCompat.App) ---')
const root = dom.window.document.getElementById('app')
mount(() => mod.App(), root)
const html = root.innerHTML.replace(/<style>[\s\S]*?<\/style>/, '<style>…</style>')
console.log(html)
