import { describe, expect, it } from 'vitest'
// Tests pull from `meta.ts` (vscode-runtime-free) rather than `index.ts`
// (which imports the `vscode` module — only resolvable when running inside
// VS Code itself).
import { EXTENSION_NAME, VERSION } from '../src/meta.js'

describe('vscode-tu', () => {
  it('exposes a version', () => {
    expect(VERSION).toBe('0.0.1')
  })

  it('exports an extension name', () => {
    expect(EXTENSION_NAME).toBe('vscode-tu')
  })
})
