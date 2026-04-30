export const VERSION = '0.0.0'

export const COMMANDS = ['build', 'dev', 'check', 'fmt'] as const
export type Command = (typeof COMMANDS)[number]

export { runCheck, formatDiagnostic, type CheckOptions, type CheckResult } from './check.js'
