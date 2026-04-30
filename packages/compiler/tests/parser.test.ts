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

  it('parses a let with a string literal value', () => {
    expect(ast('let x = "hi"')).toEqual({
      kind: 'Program',
      body: [
        {
          kind: 'LetDecl',
          exported: true,
          name: 'x',
          value: { kind: 'StringLit', value: 'hi' },
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
    expect(lambda.params).toEqual([
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
    expect(tree).toMatchInlineSnapshot(`
      {
        "body": [
          {
            "exported": true,
            "kind": "LetDecl",
            "name": "App",
            "value": {
              "body": {
                "body": [
                  {
                    "children": [
                      {
                        "children": [
                          {
                            "kind": "StringLit",
                            "value": "Hello, ",
                          },
                          {
                            "kind": "Ident",
                            "name": "name",
                          },
                          {
                            "kind": "StringLit",
                            "value": "!",
                          },
                        ],
                        "kind": "TagCall",
                        "props": [],
                        "tag": "h1",
                      },
                    ],
                    "kind": "TagCall",
                    "props": [
                      {
                        "name": "class",
                        "value": {
                          "kind": "StringLit",
                          "value": "g",
                        },
                      },
                    ],
                    "tag": "div",
                  },
                ],
                "kind": "Block",
              },
              "kind": "Lambda",
              "params": [],
            },
          },
        ],
        "kind": "Program",
      }
    `)
  })

  it('reports errors with offset', () => {
    expect(() => ast('let')).toThrow(/expected Ident/)
    expect(() => ast('let x =')).toThrow(/at offset/)
  })
})
