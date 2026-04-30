import { describe, expect, it } from 'vitest'
import { compile, VERSION } from '../src/index.js'

describe('@tu/compiler', () => {
  it('exposes a version', () => {
    expect(VERSION).toBe('0.0.0')
  })

  it('compile() returns a string for any source', () => {
    const out = compile('let x = 1')
    expect(typeof out).toBe('string')
    expect(out).toContain('@tu/compiler stub')
  })

  it('compile() rejects non-string input', () => {
    // @ts-expect-error — runtime guard test
    expect(() => compile(42)).toThrow(TypeError)
  })
})
