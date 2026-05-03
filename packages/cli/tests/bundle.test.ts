import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runBundle } from '../src/bundle.js'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'tu-cli-bundle-'))
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('runBundle — `tu bundle` integration (M8 Phase 6)', () => {
  it('writes shared module + per-file outputs; merges identical interfaces', () => {
    const a = join(tmp, 'a.tu')
    const b = join(tmp, 'b.tu')
    writeFileSync(a, 'export interface User { id: number; name: string }\n')
    writeFileSync(b, 'export interface Person { id: number; name: string }\n')
    const out = join(tmp, 'out')
    const result = runBundle(['a.tu', 'b.tu', '-o', 'out'], { cwd: tmp })
    expect(result.exitCode).toBe(0)
    // ONE canonical descriptor (User and Person merged).
    expect(result.descriptorsEmitted).toBe(1)
    expect(result.totalShapesSeen).toBe(2)
    // Shared module + 2 per-file outputs.
    expect(result.filesWritten.length).toBe(3)
    expect(existsSync(join(out, '__tu_types.generated.js'))).toBe(true)
    expect(existsSync(join(out, 'a.js'))).toBe(true)
    expect(existsSync(join(out, 'b.js'))).toBe(true)
    // Shared module exports the canonical descriptor under the named
    // origin (User is alphabetically first by encounter order).
    const shared = readFileSync(join(out, '__tu_types.generated.js'), 'utf-8')
    expect(shared).toContain('export const User')
    expect(shared).not.toContain('export const T_')
    // Per-file outputs alias their local names to the canonical
    // descriptor via the `__tu_canon_` import prefix (avoids name
    // collision with the local interface decl).
    const aOut = readFileSync(join(out, 'a.js'), 'utf-8')
    const bOut = readFileSync(join(out, 'b.js'), 'utf-8')
    expect(aOut).toContain('User = __tu_canon_User')
    expect(bOut).toContain('Person = __tu_canon_User')
  })

  it('--ts flag produces TypeScript outputs', () => {
    const a = join(tmp, 'a.tu')
    writeFileSync(a, 'export interface Foo { x: number }\n')
    const result = runBundle(['a.tu', '-o', 'out'], { cwd: tmp, ts: true })
    expect(result.exitCode).toBe(0)
    expect(existsSync(join(tmp, 'out', '__tu_types.generated.ts'))).toBe(true)
    expect(existsSync(join(tmp, 'out', 'a.ts'))).toBe(true)
    const shared = readFileSync(join(tmp, 'out', '__tu_types.generated.ts'), 'utf-8')
    expect(shared).toContain('TypeDescriptor as __tu_TypeDescriptor')
  })

  it('refuses zero inputs', () => {
    const result = runBundle([], { cwd: tmp })
    expect(result.exitCode).toBe(1)
  })

  it('errors on a missing input file', () => {
    const result = runBundle(['ghost.tu'], { cwd: tmp })
    expect(result.exitCode).toBe(1)
  })

  it('errors on an unknown flag', () => {
    const a = join(tmp, 'a.tu')
    writeFileSync(a, 'export let x = 1\n')
    const result = runBundle(['a.tu', '--no-such-flag'], { cwd: tmp })
    expect(result.exitCode).toBe(1)
  })
})
