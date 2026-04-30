import { describe, expect, it } from 'vitest'
import { VERSION } from '../src/index.js'

describe('create-tu', () => {
  it('exposes a version', () => {
    expect(VERSION).toBe('0.0.0')
  })
})
