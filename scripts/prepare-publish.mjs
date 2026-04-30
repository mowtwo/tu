#!/usr/bin/env node
// One-shot script to prepare every publish-ready package for npm.
//
// What it does:
//   1. Sets the same `repository`, `homepage`, `bugs` URLs on each package.
//   2. Adds `publishConfig.access: "public"` (mandatory for first-publish of
//      @-scoped packages — otherwise npm rejects with "Payment Required").
//   3. Adds a `keywords` array (per-package, tuned to the package role).
//   4. Bumps `version` to the target version passed as the first arg.
//
// Usage: node scripts/prepare-publish.mjs <newVersion>
//
// Re-run with the same version is idempotent — the script only writes when
// values actually change.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')

const newVersion = process.argv[2]
if (!newVersion) {
  console.error('Usage: node scripts/prepare-publish.mjs <newVersion>')
  process.exit(1)
}

const REPO_URL = 'https://github.com/mowtwo/tu'
const HOMEPAGE = 'https://mowtwo.github.io/tu/'

// Per-package keywords — narrowed to the package's actual role so npm search
// surfaces them appropriately (rather than every package having identical
// keyword bags).
const PACKAGE_META = {
  '@tu-ui/compiler': {
    keywords: ['tu', 'tu-lang', 'compiler', 'parser', 'codegen', 'reactive', 'signals'],
  },
  '@tu-ui/runtime': {
    keywords: ['tu', 'tu-lang', 'runtime', 'reactive', 'signals', 'tc39-signals', 'ssr', 'hydrate', 'custom-elements'],
  },
  '@tu-ui/vite': {
    keywords: ['tu', 'tu-lang', 'vite', 'vite-plugin', 'reactive'],
  },
  '@tu-ui/lsp': {
    keywords: ['tu', 'tu-lang', 'lsp', 'language-server', 'typescript'],
  },
  '@tu-ui/cli': {
    keywords: ['tu', 'tu-lang', 'cli'],
  },
  '@tu-ui/format': {
    keywords: ['tu', 'tu-lang', 'formatter', 'prettier-plugin'],
  },
  '@tu-ui/std': {
    keywords: ['tu', 'tu-lang', 'stdlib'],
  },
  'create-tu': {
    keywords: ['tu', 'tu-lang', 'create', 'scaffold', 'starter'],
  },
}

const packageDirs = [
  'packages/compiler',
  'packages/runtime',
  'packages/vite-tu',
  'packages/lsp',
  'packages/cli',
  'packages/format',
  'packages/std',
  'packages/create-tu',
]

let touched = 0
for (const rel of packageDirs) {
  const path = join(repoRoot, rel, 'package.json')
  const original = readFileSync(path, 'utf-8')
  const pkg = JSON.parse(original)
  const meta = PACKAGE_META[pkg.name]
  if (!meta) {
    console.error(`Skipping ${pkg.name} — no PACKAGE_META entry`)
    continue
  }

  pkg.version = newVersion
  pkg.author = 'mow2'
  pkg.homepage = HOMEPAGE
  pkg.repository = {
    type: 'git',
    url: `git+${REPO_URL}.git`,
    directory: rel,
  }
  pkg.bugs = { url: `${REPO_URL}/issues` }
  pkg.keywords = meta.keywords
  pkg.publishConfig = { access: 'public' }

  // Ordering: standard fields first (name/version/desc/keywords) then
  // module/types, then deps, then scripts. Use a small canonical key order
  // so the resulting file diffs cleanly.
  const ordered = canonicalize(pkg)
  const next = JSON.stringify(ordered, null, 2) + '\n'
  if (next !== original) {
    writeFileSync(path, next)
    touched++
    console.log(`updated ${rel}/package.json (now ${pkg.version})`)
  }
}
console.log(`\n${touched} package.json files updated`)

function canonicalize(pkg) {
  const order = [
    'name', 'version', 'description', 'keywords', 'author', 'license',
    'homepage', 'repository', 'bugs', 'type', 'main', 'types', 'bin',
    'exports', 'files', 'scripts', 'dependencies', 'peerDependencies',
    'devDependencies', 'publishConfig',
  ]
  const out = {}
  for (const k of order) {
    if (pkg[k] !== undefined) out[k] = pkg[k]
  }
  // Spill any unknown keys at the end so we don't accidentally drop them.
  for (const k of Object.keys(pkg)) {
    if (!(k in out)) out[k] = pkg[k]
  }
  return out
}
