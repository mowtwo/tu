import { describe, expect, it } from 'vitest'
import { tokenize } from '../src/lexer.js'
import { parse } from '../src/parser.js'

function ast(src: string) {
  // M5.5: param-type slicing uses the parser's source field, so the
  // helper must thread the raw source through.
  return parse(tokenize(src), src)
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

  it('parses `export default let` as a default public binding', () => {
    expect(ast('export default let App = () => div { "Hi" }')).toMatchObject({
      kind: 'Program',
      body: [
        {
          kind: 'LetDecl',
          exported: true,
          default: true,
          name: 'App',
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

  it('tolerates `;` as a no-op statement separator inside a block', () => {
    // The lexer admits `;` (added in M2.4 for type spans). Inside a block
    // the parser treats it as an optional separator — `{ a = 1; b = 2 }`
    // and `{ a = 1 \n b = 2 }` parse to the same Block.
    const tree = ast('let f = () => { count = 1; count = 2 }')
    const lambda = (tree.body[0] as { value: { body: { body: unknown[] } } }).value
    expect(lambda.body.body).toHaveLength(2)
  })

  it('parses `{ x: 1, y: 2 }` as ObjectLit', () => {
    const tree = ast('let p = { x: 1, y: 2 }')
    expect((tree.body[0] as { value: unknown }).value).toMatchObject({
      kind: 'ObjectLit',
      properties: [
        { key: 'x', keyKind: 'ident', value: { kind: 'NumberLit', value: 1 } },
        { key: 'y', keyKind: 'ident', value: { kind: 'NumberLit', value: 2 } },
      ],
    })
  })

  it('parses empty `{}` as an empty ObjectLit (not a Block)', () => {
    const tree = ast('let p = {}')
    expect((tree.body[0] as { value: unknown }).value).toMatchObject({
      kind: 'ObjectLit',
      properties: [],
    })
  })

  it('parses string keys: `{ "data-id": 7 }`', () => {
    const tree = ast('let p = { "data-id": 7 }')
    expect((tree.body[0] as { value: unknown }).value).toMatchObject({
      kind: 'ObjectLit',
      properties: [
        { key: 'data-id', keyKind: 'string', value: { kind: 'NumberLit', value: 7 } },
      ],
    })
  })

  it('parses computed object keys: `{ [key]: value }`', () => {
    const tree = ast('let p = { [key]: value }')
    expect((tree.body[0] as { value: unknown }).value).toMatchObject({
      kind: 'ObjectLit',
      properties: [
        {
          keyKind: 'computed',
          computedKey: { kind: 'Ident', name: 'key' },
          value: { kind: 'Ident', name: 'value' },
        },
      ],
    })
  })

  it('keeps `{ x }` as a Block (single-ident is NOT shorthand sugar)', () => {
    // Shorthand-property sugar collides with the more common "block last
    // expression returns its value" idiom; tracked in DEFERRED.
    const tree = ast('let f = () => { x }')
    const lambda = (tree.body[0] as { value: { body: unknown } }).value as { body: unknown }
    expect(lambda.body).toMatchObject({
      kind: 'Block',
      body: [{ kind: 'Ident', name: 'x' }],
    })
  })

  it('keeps `{ let y = 1; y }` as a Block (LocalLet is the disambiguator)', () => {
    const tree = ast('let f = () => { let y = 1; y }')
    const lambda = (tree.body[0] as { value: { body: unknown } }).value as { body: unknown }
    expect(lambda.body).toMatchObject({ kind: 'Block' })
  })

  it('parses nested object literal as a property value', () => {
    const tree = ast('let p = { outer: { inner: 1 } }')
    expect((tree.body[0] as { value: unknown }).value).toMatchObject({
      kind: 'ObjectLit',
      properties: [
        {
          key: 'outer',
          value: {
            kind: 'ObjectLit',
            properties: [{ key: 'inner', value: { kind: 'NumberLit', value: 1 } }],
          },
        },
      ],
    })
  })

  it('rejects an object literal as a tag-call child', () => {
    expect(() => ast('let App = () => div { { x: 1 } }')).toThrow(/ObjectLit as child/)
  })

  it('parses postfix member access `obj.x`', () => {
    const tree = ast('let v = origin.x')
    expect((tree.body[0] as { value: unknown }).value).toMatchObject({
      kind: 'MemberExpr',
      object: { kind: 'Ident', name: 'origin' },
      property: 'x',
    })
  })

  it('parses chained member access `a.b.c` left-leaning', () => {
    const tree = ast('let v = obj.a.b')
    expect((tree.body[0] as { value: unknown }).value).toMatchObject({
      kind: 'MemberExpr',
      property: 'b',
      object: {
        kind: 'MemberExpr',
        property: 'a',
        object: { kind: 'Ident', name: 'obj' },
      },
    })
  })

  it('member access on a call result: `make(n).x`', () => {
    const tree = ast('let v = make(n).x')
    expect((tree.body[0] as { value: unknown }).value).toMatchObject({
      kind: 'MemberExpr',
      property: 'x',
      object: { kind: 'CallExpr', callee: 'make' },
    })
  })

  it('postfix dot is REJECTED on a TagCall (whitespace-separated siblings)', () => {
    // Regression: M5.8's first cut greedily ate `.body()` as `div{x}.body()`,
    // breaking sibling pug-shorthand inside a Block. The whitelist only
    // allows postfix dot on value-yielding expr kinds — never TagCalls.
    const tree = ast(`
      let App = () => .card() {
        h1 { "x" }
        .body() { "y" }
      }
    `)
    const lambda = (tree.body[0] as { value: { body: unknown } }).value as { body: unknown }
    expect(lambda.body).toMatchObject({
      kind: 'TagCall',
      children: [
        { kind: 'TagCall', tag: 'h1' },
        { kind: 'TagCall', tag: 'div' /* pug-shorthand .body() */ },
      ],
    })
  })

  it('postfix dot is REJECTED on a component call with children', () => {
    // `Card("hi") { children }.x` — a vnode, not a value. The dot belongs
    // to the next sibling. Regression-guard for the same M5.8 bug.
    const tree = ast(`
      let App = () => {
        Card("hi") { p { "y" } }
        .body() { "z" }
      }
    `)
    const block = (tree.body[0] as { value: { body: unknown } }).value as {
      body: { body: unknown[] }
    }
    expect(block.body.body[0]).toMatchObject({ kind: 'CallExpr', callee: 'Card' })
    expect(block.body.body[1]).toMatchObject({ kind: 'TagCall', tag: 'div' })
  })

  it('postfix dot does NOT collide with prefix-dot ClassRef', () => {
    // `class: .card` keeps its ClassRef parse — the dot is at expression
    // *head*, not after a returned value.
    const tree = ast('let App = () => div(class: .card) { "x" }')
    const tag = (tree.body[0] as { value: { body: unknown } }).value as {
      body: { props: { name: string; value: { kind: string } }[] }
    }
    expect(tag.body.props[0]!.value).toMatchObject({ kind: 'ClassRef', name: 'card' })
  })

  it('parses lambda return-type annotation `(x): T => …`', () => {
    const tree = ast('let f = (x: number): string => x')
    const lambda = (tree.body[0] as { value: unknown }).value as {
      kind: string
      params: { name: string; type?: string }[]
      returnType?: string
    }
    expect(lambda.kind).toBe('Lambda')
    expect(lambda.params[0]).toMatchObject({ name: 'x', type: 'number' })
    expect(lambda.returnType).toBe('string')
  })

  it('parses lambda return-type spanning generics + nested braces', () => {
    const tree = ast('let f = (): Map<string, { v: number }> => x')
    const lambda = (tree.body[0] as { value: { returnType?: string } }).value
    expect(lambda.returnType).toBe('Map<string, { v: number }>')
  })

  it('keeps `returnType` undefined when no annotation is given', () => {
    const tree = ast('let f = (x) => x')
    const lambda = (tree.body[0] as { value: { returnType?: unknown } }).value
    expect(lambda.returnType).toBeUndefined()
  })

  it('M6.1: component named-arg call → namedArgs (not args)', () => {
    const tree = ast('let App = () => Card(title: "hi", footer: "x")')
    const lambda = (tree.body[0] as { value: { body: unknown } }).value as { body: unknown }
    expect(lambda.body).toMatchObject({
      kind: 'CallExpr',
      callee: 'Card',
      namedArgs: [
        { name: 'title', value: { kind: 'StringLit', value: 'hi' } },
        { name: 'footer', value: { kind: 'StringLit', value: 'x' } },
      ],
    })
    expect((lambda.body as { args: unknown[] }).args).toHaveLength(0)
  })

  it('M6.1: component named-arg + trailing children block', () => {
    const tree = ast('let App = () => Card(title: "hi") { p { "body" } }')
    const lambda = (tree.body[0] as { value: { body: unknown } }).value as { body: unknown }
    expect(lambda.body).toMatchObject({
      kind: 'CallExpr',
      callee: 'Card',
      namedArgs: [{ name: 'title', value: { kind: 'StringLit', value: 'hi' } }],
      children: [{ kind: 'TagCall', tag: 'p' }],
    })
  })

  it('M6.1: positional component call stays positional (BC)', () => {
    const tree = ast('let App = () => Card("hi", "body")')
    const lambda = (tree.body[0] as { value: { body: unknown } }).value as { body: unknown }
    expect(lambda.body).toMatchObject({
      kind: 'CallExpr',
      callee: 'Card',
      args: [
        { kind: 'StringLit', value: 'hi' },
        { kind: 'StringLit', value: 'body' },
      ],
    })
    expect((lambda.body as { namedArgs?: unknown }).namedArgs).toBeUndefined()
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

  it('parses exponentiation as right-associative and above multiplication', () => {
    const tree = ast('let x = 2 * 3 ** 4 ** 5')
    expect((tree.body[0] as { value: unknown }).value).toMatchObject({
      kind: 'BinaryExpr',
      op: '*',
      left: { kind: 'NumberLit', value: 2 },
      right: {
        kind: 'BinaryExpr',
        op: '**',
        left: { kind: 'NumberLit', value: 3 },
        right: {
          kind: 'BinaryExpr',
          op: '**',
          left: { kind: 'NumberLit', value: 4 },
          right: { kind: 'NumberLit', value: 5 },
        },
      },
    })
  })

  it('parses bitwise precedence below equality and above logical AND', () => {
    const tree = ast('let x = a & b == c && d')
    expect((tree.body[0] as { value: unknown }).value).toMatchObject({
      kind: 'BinaryExpr',
      op: '&&',
      left: {
        kind: 'BinaryExpr',
        op: '&',
        left: { kind: 'Ident', name: 'a' },
        right: {
          kind: 'BinaryExpr',
          op: '==',
          left: { kind: 'Ident', name: 'b' },
          right: { kind: 'Ident', name: 'c' },
        },
      },
      right: { kind: 'Ident', name: 'd' },
    })
  })
})
