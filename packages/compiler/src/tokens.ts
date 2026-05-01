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
  // logical / nullish
  OrOr,
  AndAnd,
  QuestionQuestion,
  /** `?.` — JS optional chaining (member access / call). The lexer
   *  emits this only when `?` is immediately followed by `.`; bare `?`
   *  (used in type spans for optional fields) keeps lexing as Question. */
  QuestionDot,
  /** `!` (standalone) — prefix logical-NOT or postfix TS non-null
   *  assertion. `!=` keeps lexing as a single NotEq token. */
  Bang,
  // increment / decrement (M6.5)
  PlusPlus,
  MinusMinus,
  // compound assignment (M6.5)
  PlusEq,
  MinusEq,
  StarEq,
  SlashEq,
  PercentEq,
  OrOrEq,
  AndAndEq,
  QuestionQuestionEq,
  /** `...` (M6.5) — spread / rest in call args, array, and object positions. */
  DotDotDot,
  // template literal pieces (M6.5)
  /** `` ` `` — opens or closes a template literal. */
  Backtick,
  /** Run of literal text inside `` `…` ``. The lexer collects everything
   *  between backticks / `${…}` boundaries into one chunk, with escape
   *  sequences (`\\n`, `\\\``, `\\$`, `\\\\`) decoded into `value`. */
  TemplateChunk,
  /** `${` — starts an embedded expression inside a template literal. */
  DollarLBrace,
  /** `new` operator — JS constructor call. */
  New,
  // keywords
  Let,
  Export,
  Import,
  From,
  If,
  Else,
  For,
  In,
  Try,
  Catch,
  Finally,
  Throw,
  Return,
  Async,
  Await,
  External,
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
  try: TokenKind.Try,
  catch: TokenKind.Catch,
  finally: TokenKind.Finally,
  throw: TokenKind.Throw,
  return: TokenKind.Return,
  new: TokenKind.New,
  async: TokenKind.Async,
  await: TokenKind.Await,
  external: TokenKind.External,
})
