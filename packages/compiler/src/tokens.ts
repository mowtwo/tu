export enum TokenKind {
  // literals
  Ident,
  String,
  Number,
  /** Raw CSS text inside a `style { … }` block; lexed in CSS mode. */
  CssText,
  /** Raw markdown text inside a `markdown { … }` block (M6.3); lexed
   *  in markdown mode using the same outer-brace-balance heuristic as
   *  CssText. The codegen calls markdown-it on the body to produce
   *  HTML, then emits the result as a `$static` vnode. */
  MarkdownText,
  // punctuation
  LParen,
  RParen,
  LBrace,
  RBrace,
  /** `[` — V1 used only inside raw type spans (e.g. `T[]`); not yet part of expression syntax. */
  LBracket,
  /** `]` — V1 used only inside raw type spans. */
  RBracket,
  Comma,
  Colon,
  Dot,
  Equals,
  FatArrow,
  /** `|` — V1 used only inside raw type spans (`A | B`); not part of expression syntax. */
  Pipe,
  /** `&` — V1 used only inside raw type spans (`A & B`). */
  Amp,
  /** `;` — V1 used only inside raw type spans (object type field separator). */
  Semi,
  /** `?` — V1 used only inside raw type spans (optional fields like
   *  `title?: string`). Treated by the parser as opaque type-span text;
   *  the TS shadow gets it verbatim. */
  Question,
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
  Import,
  From,
  If,
  Else,
  For,
  In,
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
  import: TokenKind.Import,
  from: TokenKind.From,
  if: TokenKind.If,
  else: TokenKind.Else,
  for: TokenKind.For,
  in: TokenKind.In,
})
