#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const VERSION = '0.1.0-alpha.8'

export interface ScaffoldOptions {
  force?: boolean
  packageManager?: 'pnpm' | 'npm' | 'yarn'
}

export interface ScaffoldResult {
  root: string
  files: string[]
}

const TU_VERSION = '^0.1.0-alpha.8'

export function scaffoldProject(
  targetDir: string,
  options: ScaffoldOptions = {}
): ScaffoldResult {
  const root = resolve(targetDir)
  const name = sanitizePackageName(basename(root) || 'tu-app')
  if (existsSync(root) && !options.force) {
    throw new Error(`target directory already exists: ${root}`)
  }
  mkdirSync(resolve(root, 'src'), { recursive: true })
  const files = projectFiles(name, options.packageManager ?? 'pnpm')
  for (const [file, contents] of files) {
    writeFileSync(resolve(root, file), contents, 'utf-8')
  }
  return { root, files: files.map(([file]) => file) }
}

function projectFiles(name: string, packageManager: 'pnpm' | 'npm' | 'yarn'): [string, string][] {
  const install = packageManager === 'npm' ? 'npm install' : `${packageManager} install`
  const dev = packageManager === 'npm' ? 'npm run dev' : `${packageManager} dev`
  return [
    ['package.json', `${JSON.stringify({
      name,
      version: '0.0.0',
      private: true,
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'vite build',
        preview: 'vite preview',
      },
      dependencies: {
        '@tu-lang/dom': TU_VERSION,
        '@tu-lang/runtime': TU_VERSION,
        '@tu-lang/vite': TU_VERSION,
        vite: '^7.3.0',
        typescript: '^5.7.0',
      },
      devDependencies: {},
    }, null, 2)}\n`],
    ['tsconfig.json', `${JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        strict: true,
        skipLibCheck: true,
        types: ['vite/client'],
      },
      include: ['src', 'vite.config.ts'],
    }, null, 2)}\n`],
    ['vite.config.ts', [
      "import tu, { tuPage } from '@tu-lang/vite'",
      "import { defineConfig } from 'vite'",
      '',
      'export default defineConfig({',
      "  plugins: [tu(), tuPage({ entry: 'src/main.tu', title: 'Tu app' })],",
      '})',
      '',
    ].join('\n')],
    ['src/main.tu', [
      'let count = 0',
      'let inc = () => count = count + 1',
      '',
      'export let App = () => main(class: "app") {',
      '  h1 { "Tu app" }',
      '  p { "count = " count }',
      '  button(onClick: inc) { "Increment" }',
      '',
      '  style {',
      '    .app {',
      '      max-width: 32rem;',
      '      margin: 4rem auto;',
      '      padding: 0 1.5rem;',
      '      font-family: system-ui, sans-serif;',
      '    }',
      '    button {',
      '      padding: 0.5rem 0.75rem;',
      '      border: 1px solid #94a3b8;',
      '      border-radius: 6px;',
      '      background: white;',
      '      cursor: pointer;',
      '    }',
      '  }',
      '}',
      '',
    ].join('\n')],
    ['README.md', [
      `# ${name}`,
      '',
      'A Tu app scaffolded with `create-tu`.',
      '',
      '```sh',
      install,
      dev,
      '```',
      '',
    ].join('\n')],
  ]
}

function sanitizePackageName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'tu-app'
}

function parseArgs(argv: string[]): { targetDir: string; options: ScaffoldOptions } {
  let targetDir = 'tu-app'
  const options: ScaffoldOptions = {}
  for (const arg of argv) {
    if (arg === '--force' || arg === '-f') {
      options.force = true
    } else if (arg.startsWith('--pm=')) {
      const pm = arg.slice('--pm='.length)
      if (pm !== 'pnpm' && pm !== 'npm' && pm !== 'yarn') {
        throw new Error(`unsupported package manager: ${pm}`)
      }
      options.packageManager = pm
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else if (!arg.startsWith('-')) {
      targetDir = arg
    } else {
      throw new Error(`unknown option: ${arg}`)
    }
  }
  return { targetDir, options }
}

function printHelp(): void {
  console.log([
    `create-tu ${VERSION}`,
    '',
    'Usage:',
    '  create-tu [dir] [--force] [--pm=pnpm|npm|yarn]',
    '',
  ].join('\n'))
}

export function main(argv = process.argv.slice(2)): void {
  try {
    const { targetDir, options } = parseArgs(argv)
    const result = scaffoldProject(targetDir, options)
    console.log(`create-tu: created ${result.root}`)
    console.log(`  ${result.files.join('\n  ')}`)
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    process.exitCode = 1
  }
}

const isCli = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) main()
