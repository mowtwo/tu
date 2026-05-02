// M6.11 — run the Suspense demo through both async SSR pipelines:
//   (1) renderToStringAsync — awaits everything, emits one HTML string.
//   (2) renderToStream      — flushes the shell + per-boundary fallbacks
//                             first, streams resolved bodies later.
import { compile } from '@tu-lang/compiler'
import {
  renderPageAsync,
  renderToStream,
  renderToStringAsync,
} from '@tu-lang/runtime'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const sourcePath = resolve(here, 'Page.tu')
const compiled = compile(readFileSync(sourcePath, 'utf-8'))

const outDir = resolve(here, 'dist')
mkdirSync(outDir, { recursive: true })
const outPath = resolve(outDir, 'Page.mjs')
writeFileSync(outPath, compiled)
const mod = await import(pathToFileURL(outPath).href)

// ─── Pipeline 1 — full async render ────────────────────────────────
console.log('=== renderToStringAsync (await all, emit one HTML string) ===')
const t0 = Date.now()
const fullHtml = await renderPageAsync(() => mod.Page(), {
  title: 'Tu Suspense demo',
  bodyClass: 'demo',
})
const elapsed = Date.now() - t0
console.log(`  resolved in ${elapsed}ms — ${fullHtml.length} bytes\n`)
console.log(fullHtml)

// ─── Pipeline 2 — streaming render ─────────────────────────────────
console.log('\n=== renderToStream (per-boundary flush) ===')
const stream = renderToStream(() => mod.Page(), {
  title: 'Tu Suspense demo (streaming)',
})
const reader = stream.getReader()
const decoder = new TextDecoder()
let chunkN = 0
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  chunkN += 1
  const text = decoder.decode(value, { stream: true })
  console.log(`\n  ─── chunk ${chunkN} (${value.length} bytes) ───`)
  console.log(text)
}
const tail = decoder.decode()
if (tail.length > 0) {
  console.log(`\n  ─── tail (${tail.length} bytes) ───`)
  console.log(tail)
}
console.log(`\n✓ stream closed after ${chunkN} chunks.`)
