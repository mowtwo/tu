import { describe, expect, it } from 'vitest'
import { tokenize } from '../src/lexer.js'
import { TokenKind } from '../src/tokens.js'

describe('lexer', () => {
  it('emits a sole EOF for empty input', () => {
    const tokens = tokenize('')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.kind).toBe(TokenKind.Eof)
  })

  it('lexes identifiers and keywords', () => {
    const tokens = tokenize('let foo = bar')
    expect(tokens.map((t) => t.kind)).toEqual([
      TokenKind.Let,
      TokenKind.Ident,
      TokenKind.Equals,
      TokenKind.Ident,
      TokenKind.Eof,
    ])
    expect(tokens[1]?.text).toBe('foo')
    expect(tokens[3]?.text).toBe('bar')
  })

  it('lexes string literals with escapes', () => {
    const tokens = tokenize(`"hello\\n\\"world\\""`)
    expect(tokens[0]?.kind).toBe(TokenKind.String)
    expect(tokens[0]?.value).toBe('hello\n"world"')
  })

  it('lexes numbers', () => {
    const tokens = tokenize('42 100')
    expect(tokens[0]?.kind).toBe(TokenKind.Number)
    expect(tokens[0]?.value).toBe(42)
    expect(tokens[1]?.value).toBe(100)
  })

  it('lexes punctuation and fat arrow', () => {
    const tokens = tokenize('(){},:= =>')
    expect(tokens.map((t) => t.kind)).toEqual([
      TokenKind.LParen,
      TokenKind.RParen,
      TokenKind.LBrace,
      TokenKind.RBrace,
      TokenKind.Comma,
      TokenKind.Colon,
      TokenKind.Equals,
      TokenKind.FatArrow,
      TokenKind.Eof,
    ])
  })

  it('skips line comments and whitespace', () => {
    const tokens = tokenize(`
      // a comment
      let x = 1 // trailing
    `)
    expect(tokens.map((t) => t.kind)).toEqual([
      TokenKind.Let,
      TokenKind.Ident,
      TokenKind.Equals,
      TokenKind.Number,
      TokenKind.Eof,
    ])
  })

  it('throws on unterminated string', () => {
    expect(() => tokenize('"abc')).toThrow(/Unterminated string/)
  })

  it('throws on unexpected character', () => {
    expect(() => tokenize('@')).toThrow(/Unexpected character/)
  })

  it('records source offsets', () => {
    const tokens = tokenize('let x')
    expect(tokens[0]).toMatchObject({ start: 0, end: 3 })
    expect(tokens[1]).toMatchObject({ start: 4, end: 5 })
  })

  it('lexes control-flow keywords', () => {
    const tokens = tokenize('if else for in match')
    expect(tokens.map((t) => t.kind)).toEqual([
      TokenKind.If,
      TokenKind.Else,
      TokenKind.For,
      TokenKind.In,
      TokenKind.Match,
      TokenKind.Eof,
    ])
  })

  it('lexes comparison operators', () => {
    const tokens = tokenize('< > <= >= == !=')
    expect(tokens.map((t) => t.kind)).toEqual([
      TokenKind.Lt,
      TokenKind.Gt,
      TokenKind.LtEq,
      TokenKind.GtEq,
      TokenKind.EqEq,
      TokenKind.NotEq,
      TokenKind.Eof,
    ])
  })

  it('distinguishes = / == / =>', () => {
    const tokens = tokenize('= == =>')
    expect(tokens.map((t) => t.kind)).toEqual([
      TokenKind.Equals,
      TokenKind.EqEq,
      TokenKind.FatArrow,
      TokenKind.Eof,
    ])
  })

  it('lexes lone underscore as Underscore (not Ident)', () => {
    const tokens = tokenize('_ _x')
    expect(tokens[0]?.kind).toBe(TokenKind.Underscore)
    expect(tokens[1]?.kind).toBe(TokenKind.Ident)
    expect(tokens[1]?.text).toBe('_x')
  })

  it('throws on bare !', () => {
    expect(() => tokenize('!')).toThrow(/Unexpected character/)
  })
})
