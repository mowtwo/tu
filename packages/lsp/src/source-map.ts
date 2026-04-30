import type { SourceMapV3 } from '@tu/compiler'

/**
 * Decoded mapping segment: the position in the generated TS, plus the
 * corresponding position in the source `.tu` (0-based for both axes).
 */
export interface MappingSegment {
  genLine: number
  genCol: number
  srcLine: number
  srcCol: number
}

const VLQ_VALUE: Record<string, number> = (() => {
  const out: Record<string, number> = {}
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  for (let i = 0; i < chars.length; i++) {
    const ch = chars.charAt(i)
    out[ch] = i
  }
  return out
})()

/**
 * Decode a single VLQ-encoded number from the start of `s`. Returns the
 * decoded value AND the number of base64 chars consumed.
 */
function decodeVLQ(s: string, start: number): { value: number; consumed: number } {
  let result = 0
  let shift = 0
  let i = start
  while (i < s.length) {
    const digit = VLQ_VALUE[s.charAt(i)]
    if (digit === undefined) throw new Error(`invalid VLQ char ${JSON.stringify(s.charAt(i))} at ${i}`)
    const continuation = digit & 0b100000
    const value = digit & 0b011111
    result |= value << shift
    shift += 5
    i++
    if (!continuation) break
  }
  // The lowest bit is the sign. Recover the signed integer.
  const negative = result & 1
  const magnitude = result >>> 1
  return {
    value: negative ? -magnitude : magnitude,
    consumed: i - start,
  }
}

/**
 * Decode a V3 `mappings` field into a flat array of segments. Each generated
 * line is `;`-separated; each segment within a line is `,`-separated. Within
 * a generated line, genCol resets to 0 between lines but srcLine/srcCol
 * accumulate across the whole map.
 */
export function decodeMappings(mappings: string): MappingSegment[] {
  const out: MappingSegment[] = []
  let prevSrcLine = 0
  let prevSrcCol = 0
  const lines = mappings.split(';')
  for (let genLine = 0; genLine < lines.length; genLine++) {
    const line = lines[genLine] ?? ''
    if (line.length === 0) continue
    let prevGenCol = 0
    const segments = line.split(',')
    for (const seg of segments) {
      if (seg.length === 0) continue
      let cursor = 0
      const genColDelta = decodeVLQ(seg, cursor)
      cursor += genColDelta.consumed
      const genCol = prevGenCol + genColDelta.value
      prevGenCol = genCol
      // 1-segment form (only generated col) — rare; nothing to map.
      if (cursor >= seg.length) continue
      // Source index — we only ever write 0 (single-source maps).
      const srcIdxDelta = decodeVLQ(seg, cursor)
      cursor += srcIdxDelta.consumed
      const srcLineDelta = decodeVLQ(seg, cursor)
      cursor += srcLineDelta.consumed
      const srcLine = prevSrcLine + srcLineDelta.value
      prevSrcLine = srcLine
      const srcColDelta = decodeVLQ(seg, cursor)
      cursor += srcColDelta.consumed
      const srcCol = prevSrcCol + srcColDelta.value
      prevSrcCol = srcCol
      out.push({ genLine, genCol, srcLine, srcCol })
    }
  }
  return out
}

/**
 * Map a position in the generated TS to the closest (≤) position in the
 * source `.tu`. The compiler emits per-statement mappings (M2 V1 source-map
 * granularity), so an error on `tsLine 5 / tsCol 12` lands on the start of
 * the `.tu` statement that produced TS line 5 — coarse but correct: every
 * diagnostic at least points at the right `let` / `import`.
 *
 * If the generated position falls before the first mapping (e.g., inside
 * the auto-injected runtime import), returns (0, 0).
 */
export function mapToSource(
  segments: MappingSegment[],
  genLine: number,
  genCol: number
): { line: number; col: number } {
  if (segments.length === 0) return { line: 0, col: 0 }
  // Find the latest segment whose (genLine, genCol) <= (genLine, genCol).
  // Linear scan is fine — V1 source maps have one segment per top-level
  // statement, so tens at most.
  let best: MappingSegment | undefined
  for (const seg of segments) {
    if (seg.genLine > genLine) break
    if (seg.genLine === genLine && seg.genCol > genCol) break
    best = seg
  }
  if (!best) return { line: 0, col: 0 }
  return { line: best.srcLine, col: best.srcCol }
}

/**
 * Convenience: decode a source map and return a mapping function.
 */
export function buildSourceMapper(
  map: Pick<SourceMapV3, 'mappings'>
): (genLine: number, genCol: number) => { line: number; col: number } {
  const segments = decodeMappings(map.mappings)
  return (genLine, genCol) => mapToSource(segments, genLine, genCol)
}
