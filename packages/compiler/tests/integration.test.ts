import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { renderToString } from '@tu/runtime'
import { describe, expect, it } from 'vitest'
import { compile } from '../src/index.js'

const here = dirname(fileURLToPath(import.meta.url))

async function compileAndRun<T>(
  source: string,
  call: (mod: Record<string, unknown>) => T
): Promise<T> {
  const js = compile(source)
  const outPath = resolve(here, '.tu-tmp', `out-${process.pid}-${Date.now()}-${Math.random()}.mjs`)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, js)
  try {
    const mod = (await import(pathToFileURL(outPath).href)) as Record<string, unknown>
    return call(mod)
  } finally {
    rmSync(dirname(outPath), { recursive: true, force: true })
  }
}

describe('compile + render end-to-end', () => {
  it('renders the canonical Greeting example', async () => {
    const html = await compileAndRun(
      `
        let Greeting = (name: string) => {
          div(class: "greet") {
            h1 { "Hello, " name "!" }
            p { "Welcome to Tu" }
          }
        }
      `,
      (mod) => {
        const fn = mod['Greeting'] as (n: string) => unknown
        return renderToString(fn('World') as never)
      }
    )
    expect(html).toBe('<div class="greet"><h1>Hello, World!</h1><p>Welcome to Tu</p></div>')
  })

  it('handles void elements correctly', async () => {
    const html = await compileAndRun(
      `let Card = () => div { img(src: "/a.png") }`,
      (mod) => {
        const fn = mod['Card'] as () => unknown
        return renderToString(fn() as never)
      }
    )
    expect(html).toBe('<div><img src="/a.png"></div>')
  })

  it('escapes user data in text and attributes', async () => {
    const html = await compileAndRun(
      `let Risk = (raw: string) => p(title: raw) { raw }`,
      (mod) => {
        const fn = mod['Risk'] as (s: string) => unknown
        return renderToString(fn('<x>"&y') as never)
      }
    )
    // Attributes escape &, ", and < (but not >); text escapes &, <, and >.
    expect(html).toBe('<p title="&lt;x>&quot;&amp;y">&lt;x&gt;"&amp;y</p>')
  })
})
