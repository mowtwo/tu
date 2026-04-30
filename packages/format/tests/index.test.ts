import { describe, expect, it } from 'vitest'
import { FORMATTER_NAME, VERSION } from '../src/index.js'

describe('@tu-ui/format', () => {
  it('exposes a version', () => {
    expect(VERSION).toBe('0.0.0')
  })

  it('exports a formatter name', () => {
    expect(FORMATTER_NAME).toBe('@tu-ui/format')
  })
})
