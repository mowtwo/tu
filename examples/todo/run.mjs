// Compile Todo.tu, swap items between empty / one / many, and watch the
// for-loop, if/else, and match arms all re-render reactively.
import { compile } from '@tu-lang/compiler'
import { renderToString } from '@tu-lang/runtime'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const sourcePath = resolve(__dirname, 'Todo.tu')
const outPath = resolve(__dirname, 'dist', 'Todo.mjs')

const source = readFileSync(sourcePath, 'utf-8')
const compiled = compile(source)

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, compiled)

const mod = await import(pathToFileURL(outPath).href)

console.log('--- compiled JS ---')
console.log(compiled.trim())

setItems([])
print('empty')

setItems(['buy milk'])
print('one item')

setItems(['buy milk', 'walk the dog', 'write Tu'])
print('three items')

function setItems(arr) {
  mod.items.set(arr)
  mod.count.set(arr.length)
}

function print(label) {
  console.log(`\n--- ${label} ---`)
  console.log(`  count.get() = ${mod.count.get()}`)
  console.log(`  label.get() = "${mod.label.get()}"`)
  console.log(`  Todo() rendered:`)
  console.log(`    ${renderToString(mod.Todo())}`)
}
