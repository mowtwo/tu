#!/usr/bin/env node
import { COMMANDS, VERSION } from './index.js'

const args = process.argv.slice(2)
const cmd = args[0] ?? 'help'

const help = `tu ${VERSION}

Usage:
  tu <command> [...args]

Commands (stubbed in M0; real implementations land in M5):
${COMMANDS.map((c) => `  ${c}`).join('\n')}
  help      Show this message
`

if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
  console.log(help)
  process.exit(0)
}

if (!(COMMANDS as readonly string[]).includes(cmd)) {
  console.error(`tu: unknown command '${cmd}'\n${help}`)
  process.exit(1)
}

console.log(`tu ${cmd}: not implemented yet (planned in M5)`)
process.exit(0)
