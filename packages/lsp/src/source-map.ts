import type { SourceMapV3, TokenMapping } from '@tu/compiler'
import { lineColAt } from '@tu/compiler'

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

/**
 * Map a generated TS byte range `[genStart, genStart + genLength)` to a
 * source `.tu` range. Uses the per-token mapping list (richer than V3) to
 * find the most-specific span that contains the diagnostic, so a TS error
 * on a single identifier squiggles only that identifier in the source.
 *
 * Strategy: find the tightest TokenMapping whose JS span contains
 * `genStart`, plus the tightest one that contains `(genStart + genLength - 1)`,
 * and return their combined source span. Falls back to the per-statement
 * mapper when no token covers the position (e.g. inside a synthetic emit
 * like `.get()`).
 */
export function mapTSRangeToSource(
  tokens: TokenMapping[],
  generated: string,
  source: string,
  genStart: number,
  genLength: number,
  fallback: (genLine: number, genCol: number) => { line: number; col: number }
): { line: number; col: number; length: number } {
  const genEnd = Math.max(genStart, genStart + genLength)
  const startTok = tightestContaining(tokens, genStart)
  // For length === 0 / 1 diagnostics, the start-side token is enough.
  const endTok = genLength <= 1 ? startTok : tightestContaining(tokens, genEnd - 1)
  if (startTok && endTok) {
    const srcStart = Math.min(startTok.srcStart, endTok.srcStart)
    const srcEnd = Math.max(startTok.srcEnd, endTok.srcEnd)
    const startLC = lineColAt(source, srcStart)
    return {
      line: startLC.line - 1,
      col: startLC.col - 1,
      length: Math.max(srcEnd - srcStart, 1),
    }
  }
  // No token covers the diagnostic position — fall back to the per-stmt
  // mapping (start point) and a length of 1. The LSP layer expands that
  // into the let-header range as before.
  const lc = lineColAtIfPossible(generated, genStart)
  if (!lc) return { line: 0, col: 0, length: 1 }
  const mapped = fallback(lc.line, lc.col)
  return { line: mapped.line, col: mapped.col, length: 1 }
}

/**
 * Find the smallest (`jsEnd - jsStart`) TokenMapping whose JS span contains
 * `jsOffset`. Returns undefined if no mapping contains it. Linear scan is
 * fine — even large files produce a few hundred mappings.
 */
function tightestContaining(
  tokens: TokenMapping[],
  jsOffset: number
): TokenMapping | undefined {
  return tightestOnAxis(tokens, jsOffset, 'js')
}

/**
 * Mirror of `tightestContaining` but on the source axis: find the tightest
 * TokenMapping whose `[srcStart, srcEnd)` contains `srcOffset`.
 */
function tightestContainingSrc(
  tokens: TokenMapping[],
  srcOffset: number
): TokenMapping | undefined {
  return tightestOnAxis(tokens, srcOffset, 'src')
}

function tightestOnAxis(
  tokens: TokenMapping[],
  offset: number,
  axis: 'js' | 'src'
): TokenMapping | undefined {
  let best: TokenMapping | undefined
  let bestWidth = Number.POSITIVE_INFINITY
  for (const t of tokens) {
    const start = axis === 'js' ? t.jsStart : t.srcStart
    const end = axis === 'js' ? t.jsEnd : t.srcEnd
    if (start <= offset && offset < end) {
      const w = end - start
      if (w < bestWidth) {
        best = t
        bestWidth = w
      }
    }
  }
  return best
}

function lineColAtIfPossible(source: string, offset: number): { line: number; col: number } | undefined {
  if (offset < 0 || offset > source.length) return undefined
  const lc = lineColAt(source, offset)
  return { line: lc.line - 1, col: lc.col - 1 }
}

/**
 * Convert a 0-based (line, col) in `source` to a 0-based byte offset, or
 * `null` if the position is outside the file. Counterpart to `lineColAt`'s
 * 1-based coordinates — the LSP layer works in 0-based throughout, so the
 * conversion happens here.
 */
export function lineColToOffset(
  source: string,
  line: number,
  col: number
): number | null {
  if (line < 0 || col < 0) return null
  let curLine = 0
  let lineStart = 0
  for (let i = 0; i < source.length; i++) {
    if (curLine === line) {
      const lineEnd = source.indexOf('\n', lineStart)
      const eol = lineEnd < 0 ? source.length : lineEnd
      if (lineStart + col > eol) return null
      return lineStart + col
    }
    if (source.charAt(i) === '\n') {
      curLine++
      lineStart = i + 1
    }
  }
  // After the loop: either we never reached `line` (out of range), or the
  // request lands past the last newline on the trailing line.
  if (curLine === line) {
    if (lineStart + col > source.length) return null
    return lineStart + col
  }
  return null
}

/**
 * Reverse map: given a `(line, col)` in the `.tu` source, find the TS byte
 * offset of the corresponding location in the generated code, plus the
 * source-side range of the token that covered the cursor.
 *
 * Returns `null` when no TokenMapping contains the cursor — typically
 * whitespace, a punctuation token (`=`, `=>`, `(`), or a Tu keyword (`let`,
 * `if`, `for`). The hover layer treats `null` as "no info available".
 *
 * The TS offset is `jsStart + (srcOffset - srcStart)`, clamped to the JS
 * span end. For most tokens the JS and source widths match identically (the
 * codegen emits the source ident verbatim), so the cursor's interior offset
 * is preserved — pointing at the `n` of `count` lands inside `count` in the
 * generated code, not at its start. For tokens with mismatched widths
 * (e.g. ClassRef `.foo` → `"foo-tu-abc123"`) the offset clamps and the
 * type-checker still resolves the token from any interior position.
 */
export function mapSourceLineColToTS(
  tokens: TokenMapping[],
  source: string,
  line: number,
  col: number,
  options: { inclusiveEnd?: boolean } = {}
): { tsOffset: number; tokenSrcStart: number; tokenSrcEnd: number } | null {
  const srcOffset = lineColToOffset(source, line, col)
  if (srcOffset === null) return null
  // `inclusiveEnd` admits cursors sitting at exactly `srcEnd` — used by
  // completion, where the user typically asks "what idents start with what
  // I just typed?" with the cursor pinned to the end of the last char.
  const tok = options.inclusiveEnd
    ? tightestContainingSrcInclusiveEnd(tokens, srcOffset)
    : tightestContainingSrc(tokens, srcOffset)
  if (!tok) return null
  const interior = srcOffset - tok.srcStart
  const jsWidth = tok.jsEnd - tok.jsStart
  const cap = options.inclusiveEnd ? jsWidth : Math.max(0, jsWidth - 1)
  const tsOffset = tok.jsStart + Math.min(interior, cap)
  return { tsOffset, tokenSrcStart: tok.srcStart, tokenSrcEnd: tok.srcEnd }
}

function tightestContainingSrcInclusiveEnd(
  tokens: TokenMapping[],
  srcOffset: number
): TokenMapping | undefined {
  let best: TokenMapping | undefined
  let bestWidth = Number.POSITIVE_INFINITY
  for (const t of tokens) {
    if (t.srcStart <= srcOffset && srcOffset <= t.srcEnd) {
      const w = t.srcEnd - t.srcStart
      if (w < bestWidth) {
        best = t
        bestWidth = w
      }
    }
  }
  return best
}
