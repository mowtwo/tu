import { mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { disposeSessionCache, getOrCreateSession } from '../src/lsp-session.js'

let tmp: string
beforeEach(() => {
  disposeSessionCache()
  tmp = mkdtempSync(join(tmpdir(), 'tu-lsp-session-'))
})
afterEach(() => {
  disposeSessionCache()
  rmSync(tmp, { recursive: true, force: true })
})

describe('getOrCreateSession — single-slot LanguageService cache', () => {
  it('returns the same session twice for an identical (source, filename)', () => {
    const file = join(tmp, 'same.tu')
    const src = 'export let count = 0'
    const a = getOrCreateSession(src, file)
    const b = getOrCreateSession(src, file)
    expect(a).not.toBeNull()
    expect(b).toBe(a)
  })

  it('rebuilds when the root source changes', () => {
    const file = join(tmp, 'edit.tu')
    const a = getOrCreateSession('export let count = 0', file)
    const b = getOrCreateSession('export let count = 1', file)
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(b).not.toBe(a)
  })

  it('rebuilds when the root filename changes', () => {
    const src = 'export let count = 0'
    const a = getOrCreateSession(src, join(tmp, 'a.tu'))
    const b = getOrCreateSession(src, join(tmp, 'b.tu'))
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(b).not.toBe(a)
  })

  it('invalidates when an imported `.tu` file mtime advances on disk', () => {
    const cardPath = join(tmp, 'Card.tu')
    writeFileSync(cardPath, 'export let Card = (label: string) => p { label }\n')
    const appPath = join(tmp, 'App.tu')
    const appSrc = [
      'import { Card } from "./Card.tu"',
      'export let App = () => Card("hi")',
    ].join('\n')
    const first = getOrCreateSession(appSrc, appPath)
    expect(first).not.toBeNull()
    // Bump Card.tu's mtime forward — same content is fine, the cache only
    // cares about the freshness signal.
    const future = Date.now() / 1000 + 60
    utimesSync(cardPath, future, future)
    const second = getOrCreateSession(appSrc, appPath)
    expect(second).not.toBeNull()
    expect(second).not.toBe(first)
  })

  it('returns null for a Tu compile error on the root file', () => {
    const file = join(tmp, 'broken.tu')
    expect(getOrCreateSession('export let App = () => h1 { "unclosed', file)).toBeNull()
  })
})
