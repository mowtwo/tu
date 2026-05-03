import { describe, expect, it } from 'vitest'
import { COMMANDS, VERSION } from '../src/index.js'

describe('@tu-lang/cli', () => {
  it('exposes a version', () => {
    expect(VERSION).toBe('0.0.0')
  })

  it('lists known commands', () => {
    expect(COMMANDS).toEqual(['build', 'bundle', 'dev', 'check', 'fmt'])
  })
})
