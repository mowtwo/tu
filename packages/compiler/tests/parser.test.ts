import { describe, expect, it } from 'vitest'
import { tokenize } from '../src/lexer.js'
import { parse } from '../src/parser.js'

function ast(src: string) {
  return parse(tokenize(src))
}

describe('parser', () => {
  it('parses an empty program', () => {
    expect(ast('')).toEqual({ kind: 'Program', body: [] })
  })

  it('parses a bare `let` as module-private (exported: false)', () => {
    expect(ast('let x = "hi"')).toMatchObject({
      kind: 'Program',
      body: [
        {
          kind: 'LetDecl',
          exported: false,
          name: 'x',
          value: { kind: 'StringLit', value: 'hi' },
          start: 0,
        },
      ],
    })
  })

  it('parses `export let` as public (exported: true)', () => {
    expect(ast('export let x = "hi"')).toMatchObject({
      kind: 'Program',
      body: [
        {
          kind: 'LetDecl',
          exported: true,
          name: 'x',
          value: { kind: 'StringLit', value: 'hi' },
          start: 0,
        },
      ],
    })
  })

  it('parses a parameterless lambda with a tag-call body', () => {
    const tree = ast('let App = () => div { "Hi" }')
    const decl = tree.body[0]!
    expect(decl).toMatchObject({
      kind: 'LetDecl',
      name: 'App',
      value: {
        kind: 'Lambda',
        params: [],
        body: {
          kind: 'TagCall',
          tag: 'div',
          props: [],
          children: [{ kind: 'StringLit', value: 'Hi' }],
        },
      },
    })
  })

  it('parses typed parameters', () => {
    const tree = ast('let f = (name: string, age: number) => "ok"')
    const lambda = (tree.body[0] as { value: unknown }).value as {
      params: { name: string; type?: string }[]
    }
    expect(lambda.params).toMatchObject([
      { name: 'name', type: 'string' },
      { name: 'age', type: 'number' },
    ])
  })

  it('parses tag-call with props and nested children', () => {
    const tree = ast(`
      let App = () => {
        div(class: "g") {
          h1 { "Hello, " name "!" }
        }
      }
    `)
    // Match the structural shape; positional metadata (`start`, `end`,
    // `tagStart`, etc.) is asserted by the source-map tests instead.
    expect(tree).toMatchObject({
      kind: 'Program',
      body: [
        {
          kind: 'LetDecl',
          exported: false,
          name: 'App',
          value: {
            kind: 'Lambda',
            params: [],
            body: {
              kind: 'Block',
              body: [
                {
                  kind: 'TagCall',
                  tag: 'div',
                  props: [
                    {
                      name: 'class',
                      value: { kind: 'StringLit', value: 'g' },
                    },
                  ],
                  children: [
                    {
                      kind: 'TagCall',
                      tag: 'h1',
                      props: [],
                      children: [
                        { kind: 'StringLit', value: 'Hello, ' },
                        { kind: 'Ident', name: 'name' },
                        { kind: 'StringLit', value: '!' },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
    })
  })

  it('reports errors with line:col + a code frame', () => {
    expect(() => ast('let')).toThrow(/expected Ident/)
    expect(() => ast('let x =')).toThrow(/at line 1, col/)
  })

  it('parses an if expression with else branch', () => {
    const tree = ast('let x = if (1) { 2 } else { 3 }')
    expect((tree.body[0] as { value: unknown }).value).toMatchObject({
      kind: 'IfExpr',
      cond: { kind: 'NumberLit', value: 1 },
      then: { kind: 'Block', body: [{ kind: 'NumberLit', value: 2 }] },
      else: { kind: 'Block', body: [{ kind: 'NumberLit', value: 3 }] },
    })
  })

  it('parses if without else (else is absent in node)', () => {
    const tree = ast('let x = if (1) { 2 }')
    const v = (tree.body[0] as { value: { else?: unknown } }).value
    expect(v).toMatchObject({ kind: 'IfExpr' })
    expect((v as { else?: unknown }).else).toBeUndefined()
  })

  it('parses else-if as nested IfExpr in else slot', () => {
    const tree = ast('let x = if (1) { 1 } else if (2) { 2 } else { 3 }')
    const v = (tree.body[0] as { value: unknown }).value as {
      else: { kind: string; else: unknown }
    }
    expect(v.else.kind).toBe('IfExpr')
    expect(v.else.else).toMatchObject({ kind: 'Block' })
  })

  it('parses a for-in expression', () => {
    const tree = ast('let x = for item in items { item }')
    expect((tree.body[0] as { value: unknown }).value).toMatchObject({
      kind: 'ForExpr',
      item: 'item',
      iter: { kind: 'Ident', name: 'items' },
      body: { kind: 'Block', body: [{ kind: 'Ident', name: 'item' }] },
    })
  })

  it('parses `style { … }` as a StyleBlock with raw CSS preserved', () => {
    const tree = ast('let X = style { .card { color: red; } }')
    const v = (tree.body[0] as { value: unknown }).value as { kind: string; css: string }
    expect(v.kind).toBe('StyleBlock')
    expect(v.css).toContain('.card { color: red; }')
  })

  it('parses `style(...) { … }` as a tag-call (parens disambiguate)', () => {
    const tree = ast('let X = style(scoped: true) { "raw text" }')
    const v = (tree.body[0] as { value: unknown }).value as { kind: string; tag?: string }
    expect(v.kind).toBe('TagCall')
    expect(v.tag).toBe('style')
  })

  it('parses Ident = expr as AssignExpr', () => {
    const tree = ast('let f = () => count = count + 1')
    const lambda = (tree.body[0] as { value: { body: unknown } }).value as { body: unknown }
    expect(lambda.body).toMatchObject({
      kind: 'AssignExpr',
      target: 'count',
      value: {
        kind: 'BinaryExpr',
        op: '+',
        left: { kind: 'Ident', name: 'count' },
        right: { kind: 'NumberLit', value: 1 },
      },
    })
  })

  it('parses lambda-valued prop in a tag-call', () => {
    const tree = ast('let App = () => button(onClick: () => count = count + 1) { "+" }')
    const tag = (tree.body[0] as { value: { body: unknown } }).value as {
      body: { props: { name: string; value: { kind: string } }[] }
    }
    const prop = tag.body.props[0]!
    expect(prop.name).toBe('onClick')
    expect(prop.value.kind).toBe('Lambda')
  })

  it('rejects an assignment as a tag-call child', () => {
    expect(() => ast('let App = () => div { count = 5 }')).toThrow(/AssignExpr as child/)
  })

  it('parses `.foo` as ClassRef when used as a prop value', () => {
    const tree = ast('let App = () => div(class: .card) { "x" }')
    const tag = (tree.body[0] as { value: { body: unknown } }).value as {
      body: { props: { name: string; value: { kind: string; name?: string } }[] }
    }
    expect(tag.body.props[0]).toMatchObject({
      name: 'class',
      value: { kind: 'ClassRef', name: 'card' },
    })
  })

  it('desugars `.foo() {…}` to a div TagCall with class injected', () => {
    const tree = ast('let App = () => .card() { "x" }')
    const inner = (tree.body[0] as { value: { body: unknown } }).value as {
      body: { kind: string; tag: string; props: { name: string; value: { kind: string } }[] }
    }
    expect(inner.body.kind).toBe('TagCall')
    expect(inner.body.tag).toBe('div')
    expect(inner.body.props[0]).toMatchObject({
      name: 'class',
      value: { kind: 'ClassRef', name: 'card' },
    })
  })

  it('desugars bare `.foo {…}` (no parens) to a div TagCall', () => {
    const tree = ast('let App = () => .card { "x" }')
    const inner = (tree.body[0] as { value: { body: unknown } }).value as {
      body: { kind: string; tag: string; children: unknown[] }
    }
    expect(inner.body.kind).toBe('TagCall')
    expect(inner.body.tag).toBe('div')
    expect(inner.body.children).toHaveLength(1)
  })

  it('rejects an explicit `class:` prop in pug-shorthand', () => {
    expect(() => ast('let App = () => .card(class: "extra") { "x" }')).toThrow(
      /already binds class/
    )
  })

  it('parses comparison operators with lower precedence than arithmetic', () => {
    // a + 1 > 0  parses as (a + 1) > 0
    const tree = ast('let x = a + 1 > 0')
    expect((tree.body[0] as { value: unknown }).value).toMatchObject({
      kind: 'BinaryExpr',
      op: '>',
      left: {
        kind: 'BinaryExpr',
        op: '+',
        left: { kind: 'Ident', name: 'a' },
        right: { kind: 'NumberLit', value: 1 },
      },
      right: { kind: 'NumberLit', value: 0 },
    })
  })
})
