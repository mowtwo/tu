import { compileToTSWithMap } from '@tu-lang/compiler'
import { describe, expect, it } from 'vitest'
import { decodeMappings, mapSourceLineColToTS, mapToSource } from '../src/source-map.js'

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

describe('mapSourceLineColToTS — source → TS reverse lookup', () => {
  function compile(src: string) {
    const { code, tokenMappings } = compileToTSWithMap(src, { filename: 'r.tu' })
    return { code, tokenMappings, src }
  }

  it('lands the cursor inside the corresponding identifier in TS', () => {
    // `count` ident appears in both source and TS — a cursor mid-name must
    // map to a TS offset whose surrounding chars are still `count`.
    const { code, tokenMappings, src } = compile(
      'export let count = 0\nexport let App = () => p { count }'
    )
    // Hover on the `n` (col 28) inside `count` on line 1.
    const result = mapSourceLineColToTS(tokenMappings, src, 1, 28)
    expect(result).not.toBeNull()
    // Verify the TS offset is inside a `count` substring.
    const slice = code.slice(result!.tsOffset, result!.tsOffset + 4)
    expect(slice.startsWith('coun') || slice.startsWith('ount') || slice === 'unt)' || slice === 'nt.g').toBe(true)
    // Token range covers `count` (5 chars).
    expect(result!.tokenSrcEnd - result!.tokenSrcStart).toBe(5)
  })

  it('returns null when the cursor is on whitespace or a keyword', () => {
    const { tokenMappings, src } = compile('export let x = 1')
    // `e` in `export` — Tu keyword, no TokenMapping.
    expect(mapSourceLineColToTS(tokenMappings, src, 0, 0)).toBeNull()
    // The space between `export` and `let`.
    expect(mapSourceLineColToTS(tokenMappings, src, 0, 6)).toBeNull()
    // The `=` operator.
    expect(mapSourceLineColToTS(tokenMappings, src, 0, 13)).toBeNull()
  })

  it('returns null when (line, col) is outside the source bounds', () => {
    const { tokenMappings, src } = compile('export let x = 1')
    expect(mapSourceLineColToTS(tokenMappings, src, 999, 0)).toBeNull()
    expect(mapSourceLineColToTS(tokenMappings, src, -1, 0)).toBeNull()
  })

  it('tightest token wins when an inner ident is nested inside an outer call', () => {
    // `count.get()` is wrapped by the surrounding `let` decl's value range,
    // but the `count` Ident has its own narrow TokenMapping. The cursor
    // pointed at the `c` of `count` should resolve to the inner Ident's
    // src-end (i.e. cover only `count`, not the whole expression).
    const { tokenMappings, src } = compile(
      'export let count = 0\nexport let g = computed(count + 1)'
    )
    // line 1, col 24 is the `c` of `count` inside computed(...).
    const r = mapSourceLineColToTS(tokenMappings, src, 1, 24)
    expect(r).not.toBeNull()
    expect(r!.tokenSrcEnd - r!.tokenSrcStart).toBe(5)
  })
})
