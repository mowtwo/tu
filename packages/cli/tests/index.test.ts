import { describe, expect, it } from 'vitest'
import { COMMANDS, VERSION } from '../src/index.js'

describe('@tu/cli', () => {
  it('exposes a version', () => {
    expect(VERSION).toBe('0.0.0')
  })

  it('lists planned commands', () => {
    expect(COMMANDS).toEqual(['build', 'dev', 'check', 'fmt'])
  })
})
