import { describe, expect, it } from 'vitest'
import { compile, compileToTS, parse, tokenize } from '../src/index.js'

const ast = (src: string) => parse(tokenize(src))

describe('import declarations — parse', () => {
  it('parses `import { X } from "./other.tu"`', () => {
    const tree = ast('import { Card } from "./Card.tu"')
    expect(tree.body[0]).toMatchObject({
      kind: 'ImportDecl',
      names: ['Card'],
      source: './Card.tu',
    })
  })

  it('parses multiple names with optional trailing comma', () => {
    const tree = ast('import { A, B, C, } from "./mod.tu"')
    expect(tree.body[0]).toMatchObject({
      kind: 'ImportDecl',
      names: ['A', 'B', 'C'],
      source: './mod.tu',
    })
  })

  it('parses `export { X } from "./other.tu"` re-exports', () => {
    const tree = ast('export { A, B } from "./mod.tu"')
    expect(tree.body[0]).toMatchObject({
      kind: 'ReExportDecl',
      names: ['A', 'B'],
      source: './mod.tu',
    })
  })

  it('parses a default import binding', () => {
    const tree = ast('import Card from "./Card.tu"')
    expect(tree.body[0]).toMatchObject({
      kind: 'ImportDecl',
      default: 'Card',
      names: [],
      source: './Card.tu',
    })
  })

  it('imports + lets can interleave', () => {
    const tree = ast(`
      import { Card } from "./Card.tu"
      export let App = () => Card()
    `)
    expect(tree.body[0]?.kind).toBe('ImportDecl')
    expect(tree.body[1]?.kind).toBe('LetDecl')
  })
})

describe('import declarations — codegen (JS)', () => {
  it('emits the import line verbatim with the source path unchanged', () => {
    const js = compile('import { Card } from "./Card.tu"')
    expect(js).toContain('import { Card } from "./Card.tu"')
  })

  it('emits default imports', () => {
    const js = compile('import Card from "./Card.tu"')
    expect(js).toContain('import Card from "./Card.tu"')
  })

  it('emits a re-export line', () => {
    const js = compile('export { A } from "./other.tu"')
    expect(js).toContain('export { A } from "./other.tu"')
  })

  it('imported names are NOT auto-`.get()`-ed when used in markup (treated as plain idents)', () => {
    const js = compile(`
      import { Card } from "./Card.tu"
      export let App = () => Card()
    `)
    // Card is a CallExpr `Card()` — should compile to plain `Card()`, not
    // `Card.get()()`. This tests the cellKind classification path.
    expect(js).toContain('export const App = () => Card()')
  })

  it('imported component composes as a child inside a tag-call', () => {
    const js = compile(`
      import { Greeting } from "./Greeting.tu"
      export let App = () => div { Greeting("World") }
    `)
    expect(js).toContain('export const App = () => h("div", {}, [Greeting("World")])')
  })
})

describe('import declarations — codegen (TS shadow)', () => {
  it('rewrites `.tu` source paths to `.ts` so tsserver resolves the sibling shadow', () => {
    const ts = compileToTS('import { Card } from "./Card.tu"')
    expect(ts).toContain('import { Card } from "./Card.ts"')
    expect(ts).not.toContain('"./Card.tu"')
  })

  it('rewrites default import `.tu` source paths to `.ts`', () => {
    const ts = compileToTS('import Card from "./Card.tu"')
    expect(ts).toContain('import Card from "./Card.ts"')
  })

  it('rewrites re-export paths the same way', () => {
    const ts = compileToTS('export { Card } from "./Card.tu"')
    expect(ts).toContain('export { Card } from "./Card.ts"')
  })

  it('leaves non-.tu paths unchanged', () => {
    const ts = compileToTS('import { something } from "./external"')
    expect(ts).toContain('import { something } from "./external"')
  })
})
