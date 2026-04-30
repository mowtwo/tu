export enum TokenKind {
  // literals
  Ident,
  String,
  Number,
  Underscore,
  /** Raw CSS text inside a `style { … }` block; lexed in CSS mode. */
  CssText,
  // punctuation
  LParen,
  RParen,
  LBrace,
  RBrace,
  Comma,
  Colon,
  Equals,
  FatArrow,
  // arithmetic
  Plus,
  Minus,
  Star,
  Slash,
  Percent,
  // comparison
  Gt,
  Lt,
  GtEq,
  LtEq,
  EqEq,
  NotEq,
  // keywords
  Let,
  Export,
  If,
  Else,
  For,
  In,
  Match,
  // misc
  Eof,
}

export interface Token {
  kind: TokenKind
  text: string
  /** Parsed literal value (string for String, number for Number); absent otherwise. */
  value?: string | number
  /** Source byte offsets, both inclusive of start, exclusive of end. */
  start: number
  end: number
}

export const KEYWORDS: Readonly<Record<string, TokenKind>> = Object.freeze({
  let: TokenKind.Let,
  export: TokenKind.Export,
  if: TokenKind.If,
  else: TokenKind.Else,
  for: TokenKind.For,
  in: TokenKind.In,
  match: TokenKind.Match,
})
