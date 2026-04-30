import { describe, expect, it } from 'vitest'
import { compile, compileWithMap, formatError, lineColAt } from '../src/index.js'

describe('lineColAt', () => {
  it('returns 1:1 for offset 0', () => {
    expect(lineColAt('hello', 0)).toEqual({ line: 1, col: 1 })
  })

  it('counts columns within a single line', () => {
    expect(lineColAt('hello world', 6)).toEqual({ line: 1, col: 7 })
  })

  it('counts lines across newlines', () => {
    expect(lineColAt('a\nb\nc', 4)).toEqual({ line: 3, col: 1 })
  })

  it('clamps offsets past end-of-source to the final position', () => {
    expect(lineColAt('abc', 99)).toEqual({ line: 1, col: 4 })
  })
})

describe('formatError', () => {
  it('includes filename:line:col when filename is given', () => {
    const out = formatError('let x = "hi"', 4, 'oops', 'test.tu')
    expect(out).toContain('at test.tu:1:5')
  })

  it('shows a code frame with caret', () => {
    const src = "let x = \nlet y = ?"
    // offset 17 is the `?`
    const out = formatError(src, 17, 'unexpected character', 'a.tu')
    expect(out).toContain('let y = ?')
    // The caret line should be a gutter (`  | `) followed by spaces then `^`.
    expect(out).toMatch(/^\s*\|\s+\^/m)
  })
})

describe('compile errors carry line:col + code frame', () => {
  it('parser error includes filename:line:col', () => {
    expect(() =>
      compile('let App = () => h1 { "missing rbrace"', { filename: 'broken.tu' })
    ).toThrow(/broken\.tu:\d+:\d+/)
  })

  it('parser error includes the offending source line', () => {
    expect(() =>
      compile('let x = "hello"\nlet y = ?', { filename: 'broken.tu' })
    ).toThrow(/let y = \?/)
  })
})

describe('source map (V3) emit', () => {
  it('compileWithMap returns version-3 map with filename + sourcesContent', () => {
    const src = `let count = 0\nlet App = () => p { count }\n`
    const { code, map } = compileWithMap(src, { filename: 'foo.tu' })
    expect(map.version).toBe(3)
    expect(map.file).toBe('foo.tu')
    expect(map.sources).toEqual(['foo.tu'])
    expect(map.sourcesContent).toEqual([src])
    expect(typeof map.mappings).toBe('string')
    expect(map.mappings.length).toBeGreaterThan(0)
    // The compiled code carries an inline source-map data URL footer.
    expect(code).toMatch(
      /\/\/# sourceMappingURL=data:application\/json;charset=utf-8;base64,[A-Za-z0-9+/=]+/
    )
  })

  it('inline footer base64 round-trips back to the same map JSON', () => {
    const src = 'let count = 0\n'
    const { code, map } = compileWithMap(src, { filename: 'a.tu' })
    const m = code.match(/sourceMappingURL=data:application\/json;charset=utf-8;base64,([A-Za-z0-9+/=]+)/)!
    const json = Buffer.from(m[1]!, 'base64').toString('utf-8')
    expect(JSON.parse(json)).toEqual(map)
  })

  it('two top-level lets produce two mapping segments on different generated lines', () => {
    const src = 'let a = 1\nlet b = 2\n'
    const { map } = compileWithMap(src, { filename: 't.tu' })
    // Segments are separated by `;` (one entry per generated line). At least
    // two non-empty entries should exist — one for each `let`.
    const lines = map.mappings.split(';')
    const nonEmpty = lines.filter((s) => s.length > 0)
    expect(nonEmpty.length).toBeGreaterThanOrEqual(2)
  })

  it('compile() (string-only) returns code with footer included', () => {
    const code = compile('let x = 1', { filename: 'x.tu' })
    expect(code).toContain('//# sourceMappingURL=data:application/json;charset=utf-8;base64,')
  })
})
