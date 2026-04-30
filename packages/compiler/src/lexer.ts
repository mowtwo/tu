import { KEYWORDS, TokenKind, type Token } from './tokens.js'

export class Lexer {
  private pos = 0
  /** True when the previous non-trivia token was Ident `style`. */
  private styleSeen = false
  /** True when an Ident `style` was followed by `{`; next token is the CssText body. */
  private cssPending = false
  constructor(private readonly src: string) {}

  tokenize(): Token[] {
    const out: Token[] = []
    while (this.pos < this.src.length) {
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
      // Track contextual `style { ... }` opening sequence.
      if (tok.kind === TokenKind.Ident && tok.text === 'style') {
        this.styleSeen = true
      } else if (tok.kind === TokenKind.LBrace && this.styleSeen) {
        this.cssPending = true
        this.styleSeen = false
      } else {
        this.styleSeen = false
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
    }

    throw new SyntaxError(`Unexpected character ${JSON.stringify(ch)} at offset ${start}`)
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
      throw new SyntaxError(`Unterminated string starting at offset ${start}`)
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
    if (text === '_') {
      return { kind: TokenKind.Underscore, text, start, end: this.pos }
    }
    const kw = KEYWORDS[text]
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

export function tokenize(src: string): Token[] {
  return new Lexer(src).tokenize()
}
