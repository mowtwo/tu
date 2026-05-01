#!/usr/bin/env node
// Extract the `markdown { … }` body from docs/skill.tu and write it to
// docs/public/llms.txt as a clean .md-equivalent file for AI agents.
// Run from CI before tu-shu's publicDir copy; also fine to run by hand
// to refresh the committed copy.

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const cwd = process.cwd()
const skillPath = resolve(cwd, 'docs/skill.tu')
const outPath = resolve(cwd, 'docs/public/llms.txt')

const source = readFileSync(skillPath, 'utf-8')

// Find the `markdown { … }` body. The body is the depth-0 brace pair —
// scan brace-balanced from the first `markdown {`.
const marker = source.indexOf('markdown {')
if (marker < 0) {
  console.error('extract-skill-llms: no `markdown {` found in docs/skill.tu')
  process.exit(1)
}
let i = source.indexOf('{', marker) + 1
const start = i
let depth = 1
while (i < source.length && depth > 0) {
  const c = source[i]
  // Skip fenced code blocks (don't count braces inside).
  if (c === '`' && source[i + 1] === '`' && source[i + 2] === '`') {
    const end = source.indexOf('```', i + 3)
    if (end < 0) break
    i = end + 3
    continue
  }
  if (c === '`') {
    const lineEnd = source.indexOf('\n', i + 1)
    const close = source.indexOf('`', i + 1)
    if (close < 0 || (lineEnd >= 0 && close > lineEnd)) {
      i++
      continue
    }
    i = close + 1
    continue
  }
  if (c === '{') depth++
  else if (c === '}') depth--
  i++
}
const body = source.slice(start, i - 1)

// Dedent the common leading indentation (we use 4 spaces inside Tu).
const lines = body.split('\n')
let minIndent = Infinity
for (const line of lines) {
  if (line.trim() === '') continue
  const m = line.match(/^[ \t]*/)
  const len = m ? m[0].length : 0
  if (len < minIndent) minIndent = len
}
if (!isFinite(minIndent)) minIndent = 0

const dedented = lines
  .map((l) => (l.length >= minIndent ? l.slice(minIndent) : l))
  .join('\n')
  .trim()

writeFileSync(outPath, dedented + '\n')
console.log(`extract-skill-llms: wrote ${outPath} (${dedented.length} chars)`)
