// M6.0 — verify the static-HTML subtree optimization actually triggers.
//
// What it does:
//   1. Compiles Welcome.tu.
//   2. Asserts the compiled JS contains an `h("$static", {}, [], "...")`
//      call instead of the nested-h() default.
//   3. Counts how many h() calls the optimization saved.
//   4. Imports the compiled module + calls renderToString to confirm the
//      static html flows through SSR verbatim.
import { compile } from '@tu-lang/compiler'
import { renderToString } from '@tu-lang/runtime'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const sourcePath = resolve(here, 'Welcome.tu')
const compiled = compile(readFileSync(sourcePath, 'utf-8'))

// Step 1 — codegen evidence.
const staticIdx = compiled.indexOf('"$static"')
if (staticIdx === -1) {
  console.error('FAIL — compiler did not emit "$static" subtree for Welcome.tu')
  process.exit(1)
}
const hCount = (compiled.match(/\bh\s*\(/g) ?? []).length
console.log('--- compiled JS evidence ----------------------------------')
console.log('  contains "$static":', staticIdx !== -1 ? 'yes' : 'NO')
console.log('  total h() calls:    ', hCount, '(would be ~10 without M6.0)')
const slice = compiled.slice(staticIdx - 10, staticIdx + 200)
console.log('  excerpt:            ', slice.replace(/\n/g, ' ').slice(0, 240))

// Step 2 — runtime evidence.
const outDir = resolve(here, 'dist')
mkdirSync(outDir, { recursive: true })
const outPath = resolve(outDir, 'Welcome.mjs')
writeFileSync(outPath, compiled)
const mod = await import(pathToFileURL(outPath).href)
const html = renderToString(mod.App())
console.log('\n--- SSR output --------------------------------------------')
console.log(html)
const checks = [
  ['starts with <div class="page">', html.startsWith('<div class="page">')],
  ['ends with </div>', html.endsWith('</div>')],
  ['contains the heading <h1>Tu</h1>', html.includes('<h1>Tu</h1>')],
  ['list items survived', html.includes('<li>Signals at the core</li>')],
  ['escaped <div> in span text', html.includes('&lt;div&gt;')],
]
let allOk = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? '✓' : '✗'} ${label}`)
  if (!ok) allOk = false
}
if (!allOk) {
  console.error('\n✗ One or more SSR checks failed.')
  process.exit(1)
}
console.log('\n✓ static-HTML optimization confirmed (M6.0).')
