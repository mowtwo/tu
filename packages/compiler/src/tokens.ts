export enum TokenKind {
  // literals
  Ident,
  String,
  Number,
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
  // keywords
  Let,
  Export,
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
})
