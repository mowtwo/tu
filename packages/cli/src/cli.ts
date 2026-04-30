#!/usr/bin/env node
import { COMMANDS, runCheck, VERSION } from './index.js'

const args = process.argv.slice(2)
const cmd = args[0] ?? 'help'

const help = `tu ${VERSION}

Usage:
  tu <command> [...args]

Commands:
  check     Type-check one or more .tu files via @tu/lsp
${COMMANDS.filter((c) => c !== 'check')
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

if (!(COMMANDS as readonly string[]).includes(cmd)) {
  console.error(`tu: unknown command '${cmd}'\n${help}`)
  process.exit(1)
}

console.log(`tu ${cmd}: not implemented yet`)
process.exit(0)
