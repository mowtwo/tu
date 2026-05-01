#!/usr/bin/env node
// One-shot helper: convert a .md file in docs/ to a .tu page exporting
// `frontmatter` (from YAML frontmatter, if any) and a `Page` component
// whose body is the original markdown wrapped in a `markdown { … }`
// block.
//
// Usage: node scripts/migrate-md-to-tu.mjs docs/install.md
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'

const path = process.argv[2]
if (!path) {
  console.error('Usage: node scripts/migrate-md-to-tu.mjs <path-to-md>')
  process.exit(1)
}

const abs = resolve(process.cwd(), path)
const source = readFileSync(abs, 'utf-8')

// Extract YAML frontmatter (very tolerant — gray-matter would do this
// properly, but we don't need a dep here).
let frontmatter = ''
let body = source
const fmMatch = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
if (fmMatch) {
  frontmatter = fmMatch[1]
  body = fmMatch[2]
}

// Convert YAML frontmatter to a Tu object literal. We only handle
// trivial scalar `key: value` pairs since the docs files only use
// simple titles.
const fmFields = []
for (const line of frontmatter.split('\n')) {
  const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.+)$/)
  if (!m) continue
  const key = m[1]
  let value = m[2].trim()
  // Strip surrounding quotes if present.
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  }
  fmFields.push(`  ${key}: ${JSON.stringify(value)}`)
}
const frontmatterObj = fmFields.length > 0 ? `{\n${fmFields.join(',\n')}\n}` : '{}'

// Indent the body by 2 spaces so the surrounding `markdown { … }`
// preserves it readably. The compiler's dedent step strips this.
const indented = body
  .split('\n')
  .map((l) => (l.length > 0 ? '    ' + l : l))
  .join('\n')

const out = `// Generated from ${path} — Tu-native docs page.

export let frontmatter = ${frontmatterObj}

export let Page = () => div {
  markdown {
${indented}
  }
}
`

const newPath = abs.replace(/\.md$/, '.tu')
writeFileSync(newPath, out)
unlinkSync(abs)
console.log(`migrated: ${path} → ${newPath.split('/').slice(-2).join('/')}`)
