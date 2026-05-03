#!/usr/bin/env node
import { COMMANDS, runBundle, runCheck, VERSION } from './index.js'

const args = process.argv.slice(2)
const cmd = args[0] ?? 'help'

const help = `tu ${VERSION}

Usage:
  tu <command> [...args]

Commands:
  check     Type-check one or more .tu files via @tu-lang/lsp
  bundle    Compile multiple .tu files together with cross-module type
            canonicalization (M8). Produces per-file outputs + a shared
            __tu_types.generated module that all files import from.
            Usage: tu bundle <files...> [-o <outDir>] [--ts]
${COMMANDS.filter((c) => c !== 'check' && c !== 'bundle')
  .map((c) => `  ${c.padEnd(9)} (planned)`)
  .join('\n')}
  help      Show this message
`

if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
  console.log(help)
  process.exit(0)
}

if (cmd === 'check') {
  const result = runCheck(args.slice(1), { cwd: process.cwd() })
  process.exit(result.exitCode)
}

if (cmd === 'bundle') {
  const ts = args.includes('--ts') || args.includes('-t')
  const result = runBundle(
    args.slice(1).filter((a) => a !== '--ts' && a !== '-t'),
    { cwd: process.cwd(), ts }
  )
  process.exit(result.exitCode)
}

if (!(COMMANDS as readonly string[]).includes(cmd)) {
  console.error(`tu: unknown command '${cmd}'\n${help}`)
  process.exit(1)
}

console.log(`tu ${cmd}: not implemented yet`)
process.exit(0)
