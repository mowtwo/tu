import { describe, expect, it } from 'vitest'
import {
  diagnosticsAtTuBrowserFile,
  hoverAtTuBrowserPosition,
} from '../src/browser.js'

function pos(source: string, needle: string): [number, number] {
  const offset = source.indexOf(needle)
  if (offset < 0) throw new Error(`missing ${needle}`)
  const lines = source.slice(0, offset).split('\n')
  return [lines.length - 1, lines[lines.length - 1]!.length]
}

describe('browser LSP workspace adapter', () => {
  it('uses the real Tu/TS hover pipeline for live-editor models', () => {
    const source = [
      'interface User { id: number; name: string }',
      'let alice: User = { id: 1, name: "Alice" }',
      'export let App = () => div { p { alice.name } }',
    ].join('\n')
    const files = [{ path: '/types/App.tu', source }]

    const info = hoverAtTuBrowserPosition(files, '/types/App.tu', ...pos(source, 'alice.name'))

    expect(info).not.toBeNull()
    expect(info!.contents).toContain('Signal.State<User>')
    expect(info!.documentation).toContain('interface User')
  })

  it('type-checks the live-editor workspace without Node fs/path access', () => {
    const source = [
      'interface User { id: number; name: string }',
      'Exception ValidationError { field: string }',
      'let parseUser = (raw: unknown): User ? ValidationError => {',
      '  if (type.is(raw, type.Object)) { return type.as(raw, User) }',
      '  throw ValidationError("bad", { field: "(root)" })',
      '}',
      'let alice: User = { id: 1, name: "Alice" }',
    ].join('\n')

    const diags = diagnosticsAtTuBrowserFile([{ path: '/types/App.tu', source }], '/types/App.tu')

    expect(diags.map((d) => d.message)).toEqual([])
  })
})
