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
    expect(() => tokenize('"abc')).toThrow(/unterminated string/)
  })

  it('throws on unexpected character', () => {
    expect(() => tokenize('@')).toThrow(/unexpected character/)
  })

  it('records source offsets', () => {
    const tokens = tokenize('let x')
    expect(tokens[0]).toMatchObject({ start: 0, end: 3 })
    expect(tokens[1]).toMatchObject({ start: 4, end: 5 })
  })

  it('lexes control-flow keywords', () => {
    const tokens = tokenize('if else for in')
    expect(tokens.map((t) => t.kind)).toEqual([
      TokenKind.If,
      TokenKind.Else,
      TokenKind.For,
      TokenKind.In,
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

  it('lexes a lone underscore as a regular Ident', () => {
    // M1.11 dropped the `Underscore` token (its only consumer was `match`,
    // which collided with TC39 Pattern Matching). `_` and `_foo` both lex
    // as Ident now — `_` is a perfectly valid JS identifier.
    const tokens = tokenize('_ _x')
    expect(tokens[0]?.kind).toBe(TokenKind.Ident)
    expect(tokens[0]?.text).toBe('_')
    expect(tokens[1]?.kind).toBe(TokenKind.Ident)
    expect(tokens[1]?.text).toBe('_x')
  })

  it('lexes bare `!` as Bang (prefix logical-NOT / postfix non-null)', () => {
    const tokens = tokenize('!x')
    expect(tokens.map((t) => t.kind)).toEqual([TokenKind.Bang, TokenKind.Ident, TokenKind.Eof])
  })

  it('lexes `!=` as a single NotEq token (not Bang + Equals)', () => {
    const tokens = tokenize('a != b')
    expect(tokens.map((t) => t.kind)).toEqual([
      TokenKind.Ident, TokenKind.NotEq, TokenKind.Ident, TokenKind.Eof,
    ])
  })

  it('lexes `||`, `&&`, `??`, `?.` as compound tokens', () => {
    const tokens = tokenize('a || b && c ?? d?.e')
    expect(tokens.map((t) => t.kind)).toEqual([
      TokenKind.Ident, TokenKind.OrOr,
      TokenKind.Ident, TokenKind.AndAnd,
      TokenKind.Ident, TokenKind.QuestionQuestion,
      TokenKind.Ident, TokenKind.QuestionDot, TokenKind.Ident,
      TokenKind.Eof,
    ])
  })

  it('lexes a `.` as Dot (used by class refs)', () => {
    const tokens = tokenize('.card')
    expect(tokens.map((t) => t.kind)).toEqual([TokenKind.Dot, TokenKind.Ident, TokenKind.Eof])
    expect(tokens[1]?.text).toBe('card')
  })

  it('lexes `style { … }` body as a single CssText token', () => {
    const tokens = tokenize('let App = () => style { .card { padding: 1rem; } }')
    // Last five tokens are: Ident("style"), LBrace, CssText, RBrace, Eof
    expect(tokens.slice(-5).map((t) => t.kind)).toEqual([
      TokenKind.Ident,
      TokenKind.LBrace,
      TokenKind.CssText,
      TokenKind.RBrace,
      TokenKind.Eof,
    ])
    const cssTok = tokens.find((t) => t.kind === TokenKind.CssText)!
    expect(cssTok.value).toContain('.card')
    expect(cssTok.value).toContain('padding: 1rem')
  })

  it('CSS mode tracks brace depth so nested rules close cleanly', () => {
    const tokens = tokenize('let X = style { @media (min-width: 800px) { .a { color: red; } } }')
    const cssTok = tokens.find((t) => t.kind === TokenKind.CssText)!
    expect(cssTok.value).toContain('@media')
    expect(cssTok.value).toContain('.a')
    // outer RBrace must remain — not consumed by the CSS scan
    const lastBraces = tokens.filter((t) => t.kind === TokenKind.RBrace)
    expect(lastBraces.length).toBe(1)
  })

  it('CSS mode ignores `}` inside strings and block comments', () => {
    const src = `let X = style { .a::before { content: "}"; /* } not real */ } }`
    const tokens = tokenize(src)
    const cssTok = tokens.find((t) => t.kind === TokenKind.CssText)!
    expect(cssTok.value).toContain('"}"')
    expect(cssTok.value).toContain('/* } not real */')
  })

  it('does not enter CSS mode for `style(...)` (parenthesized tag-call)', () => {
    const tokens = tokenize('let X = style(scoped: true) { p { "x" } }')
    expect(tokens.find((t) => t.kind === TokenKind.CssText)).toBeUndefined()
  })
})
