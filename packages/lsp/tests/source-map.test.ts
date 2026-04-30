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
    expect(segs.length).toBe(3)
    expect(segs[0]?.srcLine).toBe(0)
    expect(segs[1]?.srcLine).toBe(1)
    expect(segs[2]?.srcLine).toBe(2)
    // genLine increases between segments (each statement on its own line).
    expect(segs[0]!.genLine).toBeLessThan(segs[1]!.genLine)
    expect(segs[1]!.genLine).toBeLessThan(segs[2]!.genLine)
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
    // Find the genLine of segment 1 (the second statement) and ask for a
    // position somewhere on it.
    const seg1 = segs[1]!
    const mapped = mapToSource(segs, seg1.genLine, seg1.genCol + 5)
    expect(mapped.line).toBe(1)
    expect(mapped.col).toBe(0)
  })

  it('a position past the last mapping pins to the last mapping', () => {
    const segs = build(['export let a = 1', 'export let b = 2'])
    const last = segs[segs.length - 1]!
    const mapped = mapToSource(segs, last.genLine + 10, 0)
    expect(mapped.line).toBe(last.srcLine)
    expect(mapped.col).toBe(last.srcCol)
  })
})
