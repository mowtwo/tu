import { compileToTSWithMap } from '@tu/compiler'
import { describe, expect, it } from 'vitest'
import { decodeMappings, mapToSource } from '../src/source-map.js'

describe('decodeMappings — V3 VLQ round-trip', () => {
  it('round-trips a single statement at the top of the file', () => {
    const { map } = compileToTSWithMap('export let x = 1', { filename: 'a.tu' })
    const segs = decodeMappings(map.mappings)
    // The compiled body has a runtime-import line + blank line, so the
    // statement starts on generated line 2 (0-based).
    expect(segs.length).toBeGreaterThan(0)
    const first = segs[0]!
    expect(first.genLine).toBeGreaterThanOrEqual(2)
    expect(first.genCol).toBe(0)
    expect(first.srcLine).toBe(0)
    expect(first.srcCol).toBe(0)
  })

  it('round-trips multiple statements with accumulated source lines', () => {
    const src = 'export let a = 1\nexport let b = 2\nexport let c = 3'
    const { map } = compileToTSWithMap(src, { filename: 't.tu' })
    const segs = decodeMappings(map.mappings)
    // M3.2: per-token mappings emit additional segments per source line —
    // at minimum the statement anchor + the bound name + the literal value.
    // Assert there's at least one segment landing on each source line.
    const srcLines = new Set(segs.map((s) => s.srcLine))
    expect(srcLines.has(0)).toBe(true)
    expect(srcLines.has(1)).toBe(true)
    expect(srcLines.has(2)).toBe(true)
    expect(segs.length).toBeGreaterThanOrEqual(3)
  })
})

describe('mapToSource — generated → source position lookup', () => {
  function build(srcLines: string[]) {
    const src = srcLines.join('\n')
    const { map } = compileToTSWithMap(src, { filename: 't.tu' })
    return decodeMappings(map.mappings)
  }

  it('positions before the first mapping clamp to (0, 0)', () => {
    const segs = build(['export let x = 1'])
    expect(mapToSource(segs, 0, 0)).toEqual({ line: 0, col: 0 })
  })

  it('a position on a mapped statement returns that statement\'s source', () => {
    const segs = build([
      'export let a = 1',
      'export let b = 2',
      'export let c = 3',
    ])
    // Find any segment whose source line is 1 (the second statement) and ask
    // for a position somewhere on its generated line. The mapper should
    // resolve back to source line 1.
    const onLineOne = segs.find((s) => s.srcLine === 1)!
    const mapped = mapToSource(segs, onLineOne.genLine, onLineOne.genCol + 5)
    expect(mapped.line).toBe(1)
  })

  it('a position past the last mapping pins to the last mapping', () => {
    const segs = build(['export let a = 1', 'export let b = 2'])
    const last = segs[segs.length - 1]!
    const mapped = mapToSource(segs, last.genLine + 10, 0)
    expect(mapped.line).toBe(last.srcLine)
    expect(mapped.col).toBe(last.srcCol)
  })
})
