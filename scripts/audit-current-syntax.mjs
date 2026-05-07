#!/usr/bin/env node
// One-off audit for the May 2026 syntax/documentation migration.
//
// This is intentionally not wired into CI: the checks encode current
// migration concerns and should be edited or deleted when the language changes.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const roots = [
  'README.md',
  'docs',
  'examples',
  'playground/src',
  'packages/tu-xing',
  'packages/vite-tu/README.md',
]

const ignoredDirs = new Set([
  'node_modules',
  'dist',
  '.tu-shu',
  '.turbo',
])

const ignoredFiles = new Set([
  // Historical/design records intentionally mention old syntax.
  'docs/DEFERRED.tu',
  'docs/TYPE-METADATA-DESIGN.md',
  // Runtime design notes legitimately mention Child including undefined.
  'docs/SSR-ASYNC-DESIGN.md',
])

const textExts = new Set([
  '.md',
  '.mdx',
  '.txt',
  '.tu',
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.json',
])

const rules = [
  {
    name: 'object-shape type alias',
    // Prefer interface for object shapes. Tuple/union aliases remain valid.
    pattern: /\b(?:export\s+)?type\s+[A-Z][A-Za-z0-9_]*\s*=\s*\{/,
  },
  {
    name: 'stale known positional component call',
    // Known user-facing examples from the named-prop migration.
    pattern: /\b(?:Card|Greeting|UserCard|Spinner|RedCard|BlueCard|Demo)\(\s*(?:"|'|[0-9])/,
  },
  {
    name: 'banned ternary in Tu-facing code',
    // Allows throws syntax like `(): R ? E =>`; catches expression `a ? b : c`.
    pattern: /(?:\)|\]|\w|"|'|`)\s*\?\s*[^:\n]+:\s*/,
    tuOnly: true,
  },
  {
    name: 'banned update operator in Tu-facing code',
    pattern: /(?<![+\-])\+\+(?![+\-])|(?<!-)--(?![-A-Za-z0-9_])/,
    tuOnly: true,
  },
  {
    name: 'stale empty-block undefined advice',
    pattern: /\{\s*undefined\s*\}|undefined\) fallthrough/,
  },
  {
    name: 'stale docs wording',
    pattern: /TS-style alias|raw RHS preserved|children-as-positional|async story yet|No spread \/ computed|spread.*aren't recognized|update operators/,
  },
]

const allowedMatches = [
  // The language reference intentionally documents the legacy form as deprecated.
  { file: 'docs/LANGUAGE.tu', rule: 'stale known positional component call' },
  // External JS examples in language docs can use normal JS ternaries.
  { file: 'docs/LANGUAGE.tu', rule: 'banned ternary in Tu-facing code' },
  { file: 'docs/LANGUAGE.tu', rule: 'banned update operator in Tu-facing code', text: '-- no .get()' },
  { file: 'docs/LANGUAGE.tu', rule: 'banned update operator in Tu-facing code', text: '-- compile to JS strict' },
  // Emitted JS examples in docs may show JS ternaries after Tu if-expression lowering.
  { file: 'examples/todo/README.md', rule: 'banned ternary in Tu-facing code' },
  // Internal playground/editor implementation is TypeScript-like Tu, not copyable sample code.
  { file: /^playground\/src\/(?:live-demo|monaco-tu|main)\.tu$/, rule: 'banned ternary in Tu-facing code' },
  { file: /^playground\/src\/(?:live-demo|monaco-tu)\.tu$/, rule: 'banned update operator in Tu-facing code' },
  // External JS blocks intentionally contain raw JS loops/update syntax.
  { file: 'examples/js-compat/JsCompat.tu', rule: 'banned update operator in Tu-facing code', text: 'i--' },
  { file: 'playground/src/live-cases.tu', rule: 'banned update operator in Tu-facing code', text: 'i--' },
  { file: 'playground/src/main.tu', rule: 'banned update operator in Tu-facing code', text: 'i--' },
  { file: 'playground/src/live-cases.tu', rule: 'banned ternary in Tu-facing code', text: '?? "?"' },
  // Normal TS/JS nullish coalescing in implementation code can look ternary-ish to a line regex.
  { file: 'packages/tu-xing/src/components/Button.tu', rule: 'banned ternary in Tu-facing code' },
  { file: 'packages/tu-xing/src/components/Badge.tu', rule: 'banned ternary in Tu-facing code' },
  { file: 'packages/tu-xing/src/components/Input.tu', rule: 'banned ternary in Tu-facing code' },
]

function walk(path, out) {
  const st = statSync(path)
  if (st.isDirectory()) {
    const base = path.split('/').pop()
    if (ignoredDirs.has(base)) return
    for (const entry of readdirSync(path)) walk(join(path, entry), out)
    return
  }
  if (!st.isFile()) return
  const rel = relative(process.cwd(), path)
  if (ignoredFiles.has(rel)) return
  const dot = rel.lastIndexOf('.')
  const ext = dot >= 0 ? rel.slice(dot) : ''
  if (!textExts.has(ext)) return
  out.push(rel)
}

function isAllowed(file, rule, text) {
  return allowedMatches.some((entry) => {
    const fileOk = typeof entry.file === 'string' ? entry.file === file : entry.file.test(file)
    if (!fileOk || entry.rule !== rule) return false
    return entry.text === undefined || text.includes(entry.text)
  })
}

const files = []
for (const root of roots) walk(root, files)

const findings = []
for (const file of files.sort()) {
  const source = readFileSync(file, 'utf-8')
  const lines = source.split('\n')
  for (const [idx, line] of lines.entries()) {
    for (const rule of rules) {
      if (rule.tuOnly && !file.endsWith('.tu')) continue
      if (!rule.pattern.test(line)) continue
      if (isAllowed(file, rule.name, line)) continue
      findings.push({ file, line: idx + 1, rule: rule.name, text: line.trim() })
    }
  }
}

if (findings.length > 0) {
  console.error(`audit-current-syntax: ${findings.length} finding(s)`)
  for (const f of findings) {
    console.error(`${f.file}:${f.line}: ${f.rule}: ${f.text}`)
  }
  process.exit(1)
}

console.log(`audit-current-syntax: clean (${files.length} files scanned)`)
