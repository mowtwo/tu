import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VERSION, scaffoldProject } from '../src/index.js'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'create-tu-'))
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('create-tu', () => {
  it('exposes a version', () => {
    expect(VERSION).toBe('0.1.0-alpha.8')
  })

  it('scaffolds a minimal Tu + Vite app', () => {
    const root = join(tmp, 'My App')
    const result = scaffoldProject(root)
    expect(result.files).toContain('package.json')
    expect(result.files).toContain('src/main.tu')
    expect(existsSync(join(root, 'vite.config.ts'))).toBe(true)
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')) as {
      name: string
      scripts: Record<string, string>
      dependencies: Record<string, string>
    }
    expect(pkg.name).toBe('my-app')
    expect(pkg.scripts.dev).toBe('vite')
    expect(pkg.dependencies['@tu-lang/vite']).toBe('^0.1.0-alpha.8')
    expect(readFileSync(join(root, 'src/main.tu'), 'utf-8')).toContain('export let App')
  })

  it('refuses to overwrite an existing directory unless force is requested', () => {
    const root = join(tmp, 'app')
    scaffoldProject(root)
    expect(() => scaffoldProject(root)).toThrow(/already exists/)
    expect(() => scaffoldProject(root, { force: true })).not.toThrow()
  })
})
