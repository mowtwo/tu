// Compile Counter.tu, mutate the count cell from outside, and watch
// renderings + computed values update reactively.
import { compile } from '@tu/compiler'
import { renderToString } from '@tu/runtime'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const sourcePath = resolve(__dirname, 'Counter.tu')
const outPath = resolve(__dirname, 'dist', 'Counter.mjs')

const source = readFileSync(sourcePath, 'utf-8')
const compiled = compile(source)

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, compiled)

const mod = await import(pathToFileURL(outPath).href)

console.log('--- compiled JS ---')
console.log(compiled.trim())

console.log('\n--- initial state ---')
print(mod)

console.log('\n--- mutate: count.set(5) ---')
mod.count.set(5)
print(mod)

console.log('\n--- mutate: count.set(15) ---')
mod.count.set(15)
print(mod)

function print(mod) {
  console.log(`  count.get()    = ${mod.count.get()}`)
  console.log(`  doubled.get()  = ${mod.doubled.get()}`)
  console.log(`  plusOne.get()  = ${mod.plusOne.get()}`)
  console.log(`  Counter() rendered:`)
  console.log(`    ${renderToString(mod.Counter())}`)
}
