// Compile Card.tu, render the component, and write the resulting HTML to
// dist/Card.html so it can be opened in a browser to inspect the styling.
import { compile } from '@tu-lang/compiler'
import { renderToString } from '@tu-lang/runtime'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const sourcePath = resolve(__dirname, 'Card.tu')
const outJsPath = resolve(__dirname, 'dist', 'Card.mjs')
const outHtmlPath = resolve(__dirname, 'dist', 'Card.html')

const source = readFileSync(sourcePath, 'utf-8')
const compiled = compile(source)

mkdirSync(dirname(outJsPath), { recursive: true })
writeFileSync(outJsPath, compiled)

const mod = await import(pathToFileURL(outJsPath).href)
const cardHtml = renderToString(mod.Card({
  title: 'Tu',
  body: 'A reactive UI language with first-class style blocks.',
}))

const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Tu — styled card demo</title>
  <style>
    body { background: #0f172a; padding: 4rem; }
  </style>
</head>
<body>
${cardHtml}
</body>
</html>
`

writeFileSync(outHtmlPath, page)

console.log('--- compiled JS ---')
console.log(compiled.trim())
console.log('\n--- rendered HTML (component fragment) ---')
console.log(cardHtml)
console.log(`\nFull page written to ${outHtmlPath}`)
console.log('Open it in a browser to verify the CSS landed correctly.')
