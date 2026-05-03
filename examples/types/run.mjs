// Compile + run the Types demo and print the runtime report.
// Showcases that interface descriptors + Exception factory + type.as
// + throws clauses round-trip cleanly through Tu's compile-then-run
// pipeline.
import { compile } from '@tu-lang/compiler'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const sourcePath = resolve(here, 'Types.tu')
const compiled = compile(readFileSync(sourcePath, 'utf-8'))

const outPath = resolve(here, 'dist', 'Types.mjs')
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, compiled)

const mod = await import(pathToFileURL(outPath).href)

// Read the auto-Signal-wrapped exports.
const aliceCell = mod.alice
const bobCell = mod.bob
// `runDemo` is a Lambda — Tu doesn't wrap function values in cells.
const alice = aliceCell.get()
const bob = bobCell.get()
const runDemo = mod.runDemo

console.log('=== alice + bob (typed-let auto-tag) ===')
console.log('alice =', alice)
console.log('bob =', bob)

const result = runDemo()
console.log('\n=== runDemo() ===')
console.log(result.report)
