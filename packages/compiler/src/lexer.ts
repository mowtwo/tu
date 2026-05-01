import { formatError } from './diagnostics.js'
import { KEYWORDS, TokenKind, type Token } from './tokens.js'

export class Lexer {
  private pos = 0
  /** True when the previous non-trivia token was Ident `style` or `markdown`. */
  private styleSeen = false
  private markdownSeen = false
  /** True when `style {` was just emitted; next token is CssText body. */
  private cssPending = false
  /** True when `markdown {` was just emitted; next token is MarkdownText body. */
  private markdownPending = false
  constructor(private readonly src: string, private readonly filename?: string) {}

  tokenize(): Token[] {
    const out: Token[] = []
    while (this.pos < this.src.length) {
      // For markdown-mode lexing we want the WHOLE body including any
      // leading whitespace after `{` — the dedent step needs to see
      // those leading spaces to compute the common indent. So skip
      // trivia AFTER checking the pending flag.
      if (this.markdownPending) {
        out.push(this.lexMarkdownText())
        this.markdownPending = false
        this.markdownSeen = false
        continue
      }
      this.skipTrivia()
      if (this.pos >= this.src.length) break
      if (this.cssPending) {
        out.push(this.lexCssText())
        this.cssPending = false
        this.styleSeen = false
        continue
      }
      const tok = this.next()
      out.push(tok)
      // Track contextual `style { ... }` / `markdown { ... }` openers.
      if (tok.kind === TokenKind.Ident && tok.text === 'style') {
        this.styleSeen = true
        this.markdownSeen = false
      } else if (tok.kind === TokenKind.Ident && tok.text === 'markdown') {
        this.markdownSeen = true
        this.styleSeen = false
      } else if (tok.kind === TokenKind.LBrace && this.styleSeen) {
        this.cssPending = true
        this.styleSeen = false
      } else if (tok.kind === TokenKind.LBrace && this.markdownSeen) {
        this.markdownPending = true
        this.markdownSeen = false
      } else {
        this.styleSeen = false
        this.markdownSeen = false
      }
    }
    out.push({ kind: TokenKind.Eof, text: '', start: this.pos, end: this.pos })
    return out
  }

  private next(): Token {
    const start = this.pos
    const ch = this.src.charAt(this.pos)

    if (ch === '"') return this.lexString(start)
    if (ch >= '0' && ch <= '9') return this.lexNumber(start)
    if (isIdentStart(ch)) return this.lexIdent(start)

    switch (ch) {
      case '(':
        return this.punct(TokenKind.LParen, start, 1)
      case ')':
        return this.punct(TokenKind.RParen, start, 1)
      case '{':
        return this.punct(TokenKind.LBrace, start, 1)
      case '}':
        return this.punct(TokenKind.RBrace, start, 1)
      case ',':
        return this.punct(TokenKind.Comma, start, 1)
      case ':':
        return this.punct(TokenKind.Colon, start, 1)
      case '.':
        return this.punct(TokenKind.Dot, start, 1)
      case '=':
        if (this.src.charAt(this.pos + 1) === '>') {
          return this.punct(TokenKind.FatArrow, start, 2)
        }
        if (this.src.charAt(this.pos + 1) === '=') {
          return this.punct(TokenKind.EqEq, start, 2)
        }
        return this.punct(TokenKind.Equals, start, 1)
      case '!':
        if (this.src.charAt(this.pos + 1) === '=') {
          return this.punct(TokenKind.NotEq, start, 2)
        }
        break
      case '<':
        if (this.src.charAt(this.pos + 1) === '=') {
          return this.punct(TokenKind.LtEq, start, 2)
        }
        return this.punct(TokenKind.Lt, start, 1)
      case '>':
        if (this.src.charAt(this.pos + 1) === '=') {
          return this.punct(TokenKind.GtEq, start, 2)
        }
        return this.punct(TokenKind.Gt, start, 1)
      case '+':
        return this.punct(TokenKind.Plus, start, 1)
      case '-':
        return this.punct(TokenKind.Minus, start, 1)
      case '*':
        return this.punct(TokenKind.Star, start, 1)
      case '/':
        return this.punct(TokenKind.Slash, start, 1)
      case '%':
        return this.punct(TokenKind.Percent, start, 1)
      case '|':
        return this.punct(TokenKind.Pipe, start, 1)
      case '&':
        return this.punct(TokenKind.Amp, start, 1)
      case ';':
        return this.punct(TokenKind.Semi, start, 1)
      case '[':
        return this.punct(TokenKind.LBracket, start, 1)
      case ']':
        return this.punct(TokenKind.RBracket, start, 1)
    }

    throw new SyntaxError(
      formatError(this.src, start, `unexpected character ${JSON.stringify(ch)}`, this.filename)
    )
  }

  private punct(kind: TokenKind, start: number, len: number): Token {
    this.pos += len
    return { kind, text: this.src.slice(start, this.pos), start, end: this.pos }
  }

  private skipTrivia(): void {
    while (this.pos < this.src.length) {
      const ch = this.src.charAt(this.pos)
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        this.pos++
        continue
      }
      if (ch === '/' && this.src.charAt(this.pos + 1) === '/') {
        while (this.pos < this.src.length && this.src.charAt(this.pos) !== '\n') {
          this.pos++
        }
        continue
      }
      break
    }
  }

  /**
   * Scan raw CSS until the matching `}` (depth 0). Tracks brace depth, skips
   * over content inside `"…"` / `'…'` strings and `/* … *​/` block comments so
   * a `}` inside a string or comment doesn't close the block prematurely.
   * Stops at the closing `}` without consuming it — the main loop emits it as
   * a normal RBrace.
   */
  private lexCssText(): Token {
    const start = this.pos
    let depth = 0
    while (this.pos < this.src.length) {
      const ch = this.src.charAt(this.pos)
      if (ch === '"' || ch === "'") {
        const quote = ch
        this.pos++
        while (this.pos < this.src.length && this.src.charAt(this.pos) !== quote) {
          if (this.src.charAt(this.pos) === '\\') {
            this.pos++
          }
          this.pos++
        }
        if (this.pos < this.src.length) this.pos++ // closing quote
        continue
      }
      if (ch === '/' && this.src.charAt(this.pos + 1) === '*') {
        this.pos += 2
        while (
          this.pos + 1 < this.src.length &&
          !(this.src.charAt(this.pos) === '*' && this.src.charAt(this.pos + 1) === '/')
        ) {
          this.pos++
        }
        if (this.pos + 1 < this.src.length) this.pos += 2
        continue
      }
      if (ch === '{') {
        depth++
        this.pos++
        continue
      }
      if (ch === '}') {
        if (depth === 0) break
        depth--
        this.pos++
        continue
      }
      this.pos++
    }
    const text = this.src.slice(start, this.pos)
    return {
      kind: TokenKind.CssText,
      text,
      value: text,
      start,
      end: this.pos,
    }
  }

  /**
   * Lex the body of a `markdown { … }` block as raw text. Same balanced-
   * outer-brace heuristic as `lexCssText` — each `{` increments depth,
   * each `}` decrements; the body ends when depth would go below zero.
   * Backtick-fenced code blocks are respected so braces inside them
   * don't unbalance the count.
   */
  private lexMarkdownText(): Token {
    const start = this.pos
    let depth = 0
    while (this.pos < this.src.length) {
      const ch = this.src.charAt(this.pos)
      // Triple-backtick fenced code block — skip to the closing fence.
      if (
        ch === '`' &&
        this.src.charAt(this.pos + 1) === '`' &&
        this.src.charAt(this.pos + 2) === '`'
      ) {
        this.pos += 3
        const close = this.src.indexOf('```', this.pos)
        if (close < 0) break
        this.pos = close + 3
        continue
      }
      // Inline `code` — skip to the closing single backtick.
      if (ch === '`') {
        this.pos++
        const close = this.src.indexOf('`', this.pos)
        if (close < 0) break
        this.pos = close + 1
        continue
      }
      if (ch === '{') {
        depth++
        this.pos++
        continue
      }
      if (ch === '}') {
        if (depth === 0) break
        depth--
        this.pos++
        continue
      }
      this.pos++
    }
    const text = this.src.slice(start, this.pos)
    return {
      kind: TokenKind.MarkdownText,
      text,
      value: text,
      start,
      end: this.pos,
    }
  }

  private lexString(start: number): Token {
    this.pos++ // consume opening quote
    let value = ''
    while (this.pos < this.src.length && this.src.charAt(this.pos) !== '"') {
      const ch = this.src.charAt(this.pos)
      if (ch === '\\') {
        this.pos++
        const esc = this.src.charAt(this.pos)
        if (esc === 'n') value += '\n'
        else if (esc === 't') value += '\t'
        else if (esc === 'r') value += '\r'
        else if (esc === '"') value += '"'
        else if (esc === '\\') value += '\\'
        else value += esc
        this.pos++
      } else {
        value += ch
        this.pos++
      }
    }
    if (this.pos >= this.src.length) {
      throw new SyntaxError(formatError(this.src, start, `unterminated string`, this.filename))
    }
    this.pos++ // closing quote
    return {
      kind: TokenKind.String,
      text: this.src.slice(start, this.pos),
      value,
      start,
      end: this.pos,
    }
  }

  private lexNumber(start: number): Token {
    while (this.pos < this.src.length) {
      const ch = this.src.charAt(this.pos)
      if (ch >= '0' && ch <= '9') this.pos++
      else break
    }
    const text = this.src.slice(start, this.pos)
    return { kind: TokenKind.Number, text, value: Number(text), start, end: this.pos }
  }

  private lexIdent(start: number): Token {
    while (this.pos < this.src.length && isIdentPart(this.src.charAt(this.pos))) {
      this.pos++
    }
    const text = this.src.slice(start, this.pos)
    // Use `hasOwn` so identifiers that happen to be Object.prototype
    // method names (`toString`, `hasOwnProperty`, `valueOf`, …) don't
    // get the inherited function as their token kind. Without this
    // guard, M5.9 method calls on those names produced tokens with a
    // function-valued `.kind` and parser errors blamed the wrong span.
    const kw = Object.hasOwn(KEYWORDS, text) ? KEYWORDS[text] : undefined
    return {
      kind: kw ?? TokenKind.Ident,
      text,
      start,
      end: this.pos,
    }
  }
}

function isIdentStart(ch: string): boolean {
  if (ch === '') return false
  return (
    (ch >= 'a' && ch <= 'z') ||
    (ch >= 'A' && ch <= 'Z') ||
    ch === '_' ||
    ch === '$'
  )
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || (ch >= '0' && ch <= '9')
}

export function tokenize(src: string, filename?: string): Token[] {
  return new Lexer(src, filename).tokenize()
}
