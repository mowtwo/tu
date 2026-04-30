// Compile Typed.tu, execute it, exercise the typed APIs, and render.
//
// Mirrors the hello/ example shape but specifically exercises:
//   • Object literal as a state-cell value (`origin: Point = { … }`)
//   • Lambda return-type annotation (`make = (n): Point => { … }`)
//   • Reactive update cycling through a computed object literal
import { compile } from '@tu/compiler'
import { renderToString } from '@tu/runtime'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const sourcePath = resolve(__dirname, 'Typed.tu')
const outPath = resolve(__dirname, 'dist', 'Typed.mjs')

const source = readFileSync(sourcePath, 'utf-8')
const compiled = compile(source)

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, compiled)

const mod = await import(pathToFileURL(outPath).href)

console.log('--- API exercise ---')
console.log('  origin.get()        =', mod.origin.get())
console.log('  make(7)             =', mod.make(7))
console.log('  snapshot.get()      =', mod.snapshot.get())

mod.n.set(42)
console.log('  after n.set(42):')
console.log('  snapshot.get()      =', mod.snapshot.get())

console.log('\n--- rendered HTML ---')
console.log(renderToString(mod.App()))
