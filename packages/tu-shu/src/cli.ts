#!/usr/bin/env node
// `tu-shu` CLI — `tu-shu build` reads tu-shu.config.{ts,js,mjs} from the
// current directory and runs the static build.
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from './build.js'
import type { TuShuConfig } from './types.js'

async function main(argv: string[]): Promise<void> {
  const cmd = argv[0] ?? 'build'
  const cwd = process.cwd()

  if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
    printHelp()
    return
  }

  if (cmd === 'build') {
    const config = await loadConfig(cwd)
    await build(cwd, config)
    return
  }

  console.error(`tu-shu: unknown command '${cmd}'`)
  printHelp()
  process.exit(1)
}

function printHelp(): void {
  console.log(`tu-shu — Tu-native static site generator

Usage:
  tu-shu build       Build the site to .tu-shu/dist (or config.outDir)
  tu-shu help        Show this help

Config file: tu-shu.config.{ts,js,mjs} in the current directory.
See @tu-lang/tu-shu README for the schema.`)
}

async function loadConfig(cwd: string): Promise<TuShuConfig> {
  for (const name of ['tu-shu.config.mjs', 'tu-shu.config.js', 'tu-shu.config.ts']) {
    const p = resolve(cwd, name)
    if (!existsSync(p)) continue
    const mod = (await import(pathToFileURL(p).href)) as { default?: TuShuConfig }
    if (!mod.default) {
      throw new Error(`tu-shu: ${name} must export default TuShuConfig`)
    }
    return mod.default
  }
  return {}
}

main(process.argv.slice(2)).catch((err) => {
  console.error('tu-shu: build failed')
  console.error(err)
  process.exit(1)
})
