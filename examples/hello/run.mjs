// Compile Greeting.tu, execute the result, render to HTML, print.
import { compile } from '@tu-lang/compiler'
import { renderToString } from '@tu-lang/runtime'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const sourcePath = resolve(__dirname, 'Greeting.tu')
const outPath = resolve(__dirname, 'dist', 'Greeting.mjs')

const source = readFileSync(sourcePath, 'utf-8')
const compiled = compile(source)

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, compiled)

const mod = await import(pathToFileURL(outPath).href)

const name = process.argv[2] ?? 'World'
const vnode = mod.Greeting(name)
const html = renderToString(vnode)

console.log('--- compiled JS ---')
console.log(compiled.trim())
console.log('--- rendered HTML ---')
console.log(html)
