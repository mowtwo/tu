import { describe, expect, it } from 'vitest'
import { SERVER_NAME, VERSION } from '../src/index.js'

describe('@tu-ui/lsp', () => {
  it('exposes a version', () => {
    expect(VERSION).toBe('0.0.0')
  })

  it('exports a server name', () => {
    expect(SERVER_NAME).toBe('@tu-ui/lsp')
  })
})
