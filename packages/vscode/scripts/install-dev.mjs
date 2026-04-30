#!/usr/bin/env node
import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(__dirname, '..')

const uninstall = process.argv.includes('--uninstall')

// VS Code looks here on macOS / Linux. Windows path is similar.
const extensionsDir = join(homedir(), '.vscode', 'extensions')
const linkPath = join(extensionsDir, 'tu-dev')

mkdirSync(extensionsDir, { recursive: true })

if (existsSync(linkPath)) {
  const stat = lstatSync(linkPath)
  if (stat.isSymbolicLink() || stat.isDirectory()) {
    rmSync(linkPath, { recursive: true, force: true })
  }
}

if (uninstall) {
  console.log(`✓ Removed Tu dev extension link at ${linkPath}`)
  process.exit(0)
}

const symlinkType = platform() === 'win32' ? 'junction' : 'dir'
symlinkSync(pkgRoot, linkPath, symlinkType)

console.log(`✓ Linked Tu dev extension`)
console.log(`  source: ${pkgRoot}`)
console.log(`  target: ${linkPath}`)
console.log(``)
console.log(`Now reload VS Code to pick it up:`)
console.log(`  Cmd+Shift+P → "Developer: Reload Window"`)
console.log(``)
console.log(`To remove later:  pnpm --filter vscode-tu dev:uninstall`)
