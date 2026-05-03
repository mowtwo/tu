export const VERSION = '0.0.0'

export const COMMANDS = ['build', 'bundle', 'dev', 'check', 'fmt'] as const
export type Command = (typeof COMMANDS)[number]

export { runCheck, formatDiagnostic, type CheckOptions, type CheckResult } from './check.js'
export { runBundle, type BundleCommandOptions, type BundleCommandResult } from './bundle.js'
