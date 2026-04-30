import { describe, expect, it } from 'vitest'
import { RUNTIME, VERSION } from '../src/index.js'

describe('@tu/runtime', () => {
  it('exposes a version', () => {
    expect(VERSION).toBe('0.0.0')
  })

  it('exports a runtime tag', () => {
    expect(RUNTIME).toBe('@tu/runtime')
  })
})
