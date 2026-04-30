// M5 composition demo runner: compile Composition.tu, mount the App in
// a jsdom-simulated browser, print the resulting DOM. Showcases:
//   - Capitalized components (Layout, Card) as function calls
//   - `children: VNode[]` as the last positional arg
//   - `Fragment { … }` from @tu-lang/runtime for multi-child returns
//   - Local `let greeting = …` inside a component body
//   - Dual class injection: `class="card card-tu-XXX"` in markup,
//     `.card-tu-XXX` only in the scoped CSS.
import { compile } from '@tu-lang/compiler'
import { mount } from '@tu-lang/runtime'
import { JSDOM } from 'jsdom'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const sourcePath = resolve(__dirname, 'Composition.tu')
const outPath = resolve(__dirname, 'dist', 'Composition.mjs')

const source = readFileSync(sourcePath, 'utf-8')
const compiled = compile(source)

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, compiled)

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>')
globalThis.document = dom.window.document
globalThis.Element = dom.window.Element
globalThis.Node = dom.window.Node
globalThis.Event = dom.window.Event

const mod = await import(pathToFileURL(outPath).href)

const root = dom.window.document.getElementById('app')
const stop = mount(() => mod.App(), root)

console.log('--- compiled output ---')
console.log(compiled.split('//# sourceMappingURL=')[0].trim())

console.log('\n--- mounted DOM ---')
console.log(root.innerHTML)

stop()
