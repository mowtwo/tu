// Compile Clicker.tu, simulate a browser via jsdom, mount the component,
// click the buttons, and print the DOM after each click. Verifies M1.5
// end-to-end without needing a real browser.
import { compile } from '@tu/compiler'
import { mount } from '@tu/runtime'
import { JSDOM } from 'jsdom'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const sourcePath = resolve(__dirname, 'Clicker.tu')
const outPath = resolve(__dirname, 'dist', 'Clicker.mjs')

const compiled = compile(readFileSync(sourcePath, 'utf-8'))
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, compiled)

console.log('--- compiled JS ---')
console.log(compiled.trim())

// Boot a jsdom and install document/Element/Event globals so @tu/runtime's
// browser code paths work in Node.
const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>')
globalThis.document = dom.window.document
globalThis.Element = dom.window.Element
globalThis.Node = dom.window.Node
globalThis.Event = dom.window.Event

const mod = await import(pathToFileURL(outPath).href)
const root = dom.window.document.getElementById('app')

mount(() => mod.Clicker(), root)
print('initial mount')

await click('+')
await click('+')
await click('+')
print('after 3× +')

await click('−')
print('after 1× −')

await click('reset')
print('after reset')

async function click(label) {
  const btn = [...dom.window.document.querySelectorAll('button')].find(
    (b) => b.textContent === label
  )
  if (!btn) throw new Error(`no button with label ${JSON.stringify(label)}`)
  btn.dispatchEvent(new dom.window.Event('click', { bubbles: true }))
  await new Promise((r) => queueMicrotask(r))
}

function print(label) {
  console.log(`\n--- ${label} ---`)
  console.log(`  count.get() = ${mod.count.get()}`)
  // Drop the inlined <style> block from the printed snippet so the diff is readable.
  const html = root.innerHTML.replace(/<style>[\s\S]*?<\/style>/, '<style>…</style>')
  console.log(`  DOM: ${html}`)
}
