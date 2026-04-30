import { describe, expect, it } from 'vitest'
import { EXTENSION_NAME, VERSION } from '../src/index.js'

describe('@tu/vscode', () => {
  it('exposes a version', () => {
    expect(VERSION).toBe('0.0.0')
  })

  it('exports an extension name', () => {
    expect(EXTENSION_NAME).toBe('@tu/vscode')
  })
})
