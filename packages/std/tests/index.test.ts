import { describe, expect, it } from 'vitest'
import { STD_NAME, VERSION } from '../src/index.js'

describe('@tu-ui/std', () => {
  it('exposes a version', () => {
    expect(VERSION).toBe('0.0.0')
  })

  it('exports a name', () => {
    expect(STD_NAME).toBe('@tu-ui/std')
  })
})
