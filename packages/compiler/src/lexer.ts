import { formatError } from './diagnostics.js'
import { KEYWORDS, TokenKind, type Token } from './tokens.js'

/** Tracks which lexing mode the cursor is in, so template literals
 *  can switch to chunk-collection between backticks and back to
 *  expression mode inside `${ … }`. The brace depth on each
 *  `template-expr` frame is used to find the matching `}` that closes
 *  the embedded expression. */
type Mode =
  | { kind: 'normal' }
  | { kind: 'template' }
  | { kind: 'template-expr'; braceDepth: number }

/** Token kinds that yield a value — after one of these, `/` is a
 *  division operator, never a regex-literal opener. */
const VALUE_YIELDING_TOKENS: ReadonlySet<TokenKind> = new Set([
  TokenKind.Ident,
  TokenKind.Number,
  TokenKind.String,
  TokenKind.Regex,
  TokenKind.RParen,
  TokenKind.RBracket,
  TokenKind.RBrace,
  TokenKind.PlusPlus,
  TokenKind.MinusMinus,
  TokenKind.Bang,
  TokenKind.Backtick, // closing backtick of a template literal
])

export class Lexer {
  private pos = 0
  /** True when the previous non-trivia token was Ident `style` or `markdown`. */
  private styleSeen = false
  private markdownSeen = false
  /** True when `style {` was just emitted; next token is CssText body. */
  private cssPending = false
  /** True when `markdown {` was just emitted; next token is MarkdownText body. */
  private markdownPending = false
  private modes: Mode[] = [{ kind: 'normal' }]
  /** Tracks whether the next `/` starts a regex literal (true) or is
   *  a division operator (false). Set to false after a value-yielding
   *  token (ident, number, closing bracket, postfix op, etc.); true
   *  in any expression-starting position. */
  private regexAllowed = true
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
      // Inside a template literal we DO NOT skip trivia — whitespace
      // is part of the literal text. Switch to chunk-collection.
      const top = this.modes[this.modes.length - 1]!
      if (top.kind === 'template') {
        const tok = this.lexTemplatePiece()
        out.push(tok)
        if (tok.kind === TokenKind.Backtick) {
          this.modes.pop() // close template; previous mode resumes
        } else if (tok.kind === TokenKind.DollarLBrace) {
          this.modes.push({ kind: 'template-expr', braceDepth: 0 })
        }
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
      // Mode transitions for template-expr frames: count braces so the
      // closing `}` of `${ … }` pops back to template-collect mode
      // even if the embedded expression contained `{ … }` of its own
      // (object literals, blocks, etc.). The terminator `}` is
      // re-tagged as TemplateExprClose so external-block scanners
      // (which use brace balance to find their own end) don't
      // miscount it as a regular RBrace.
      if (top.kind === 'template-expr') {
        if (tok.kind === TokenKind.LBrace) top.braceDepth++
        else if (tok.kind === TokenKind.RBrace) {
          if (top.braceDepth === 0) {
            this.modes.pop()
            tok.kind = TokenKind.TemplateExprClose
          } else {
            top.braceDepth--
          }
        }
      }
      // Backtick at top-level opens a new template frame.
      if (tok.kind === TokenKind.Backtick) {
        this.modes.push({ kind: 'template' })
      }
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
      // Update regex-allowed flag for the NEXT `/` we encounter. After
      // a value-yielding token (ident, number, closing bracket, etc.)
      // a `/` is division; after operators / opening brackets / start
      // of file it's a regex literal opener.
      this.regexAllowed = !VALUE_YIELDING_TOKENS.has(tok.kind)
    }
    out.push({ kind: TokenKind.Eof, text: '', start: this.pos, end: this.pos })
    return out
  }

  /** Inside a template literal we emit one of three tokens at a time:
   *  Backtick (closes the template), DollarLBrace (opens an embedded
   *  expression), or TemplateChunk (a run of literal text with escape
   *  sequences decoded). The caller (tokenize) tracks the mode stack. */
  private lexTemplatePiece(): Token {
    const start = this.pos
    if (this.src.charAt(this.pos) === '`') {
      this.pos++
      return { kind: TokenKind.Backtick, text: '`', start, end: this.pos }
    }
    if (this.src.charAt(this.pos) === '$' && this.src.charAt(this.pos + 1) === '{') {
      this.pos += 2
      return { kind: TokenKind.DollarLBrace, text: '${', start, end: this.pos }
    }
    let buf = ''
    while (this.pos < this.src.length) {
      const ch = this.src.charAt(this.pos)
      if (ch === '`') break
      if (ch === '$' && this.src.charAt(this.pos + 1) === '{') break
      if (ch === '\\') {
        const nx = this.src.charAt(this.pos + 1)
        if (nx === 'n') buf += '\n'
        else if (nx === 't') buf += '\t'
        else if (nx === 'r') buf += '\r'
        else if (nx === '`') buf += '`'
        else if (nx === '\\') buf += '\\'
        else if (nx === '$') buf += '$'
        else buf += nx
        this.pos += 2
        continue
      }
      buf += ch
      this.pos++
    }
    if (this.pos >= this.src.length) {
      throw new SyntaxError(
        formatError(this.src, start, 'unterminated template literal', this.filename)
      )
    }
    return {
      kind: TokenKind.TemplateChunk,
      text: this.src.slice(start, this.pos),
      value: buf,
      start,
      end: this.pos,
    }
  }

  private next(): Token {
    const start = this.pos
    const ch = this.src.charAt(this.pos)

    if (ch === '"') return this.lexString(start)
    if (ch === '`') return this.punct(TokenKind.Backtick, start, 1)
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
        if (this.src.charAt(this.pos + 1) === '.' && this.src.charAt(this.pos + 2) === '.') {
          return this.punct(TokenKind.DotDotDot, start, 3)
        }
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
        return this.punct(TokenKind.Bang, start, 1)
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
        if (this.src.charAt(this.pos + 1) === '+') return this.punct(TokenKind.PlusPlus, start, 2)
        if (this.src.charAt(this.pos + 1) === '=') return this.punct(TokenKind.PlusEq, start, 2)
        return this.punct(TokenKind.Plus, start, 1)
      case '-':
        if (this.src.charAt(this.pos + 1) === '-') return this.punct(TokenKind.MinusMinus, start, 2)
        if (this.src.charAt(this.pos + 1) === '=') return this.punct(TokenKind.MinusEq, start, 2)
        return this.punct(TokenKind.Minus, start, 1)
      case '*':
        if (this.src.charAt(this.pos + 1) === '=') return this.punct(TokenKind.StarEq, start, 2)
        return this.punct(TokenKind.Star, start, 1)
      case '/':
        if (this.regexAllowed) return this.lexRegex(start)
        if (this.src.charAt(this.pos + 1) === '=') return this.punct(TokenKind.SlashEq, start, 2)
        return this.punct(TokenKind.Slash, start, 1)
      case '%':
        if (this.src.charAt(this.pos + 1) === '=') return this.punct(TokenKind.PercentEq, start, 2)
        return this.punct(TokenKind.Percent, start, 1)
      case '|':
        if (this.src.charAt(this.pos + 1) === '|') {
          if (this.src.charAt(this.pos + 2) === '=') return this.punct(TokenKind.OrOrEq, start, 3)
          return this.punct(TokenKind.OrOr, start, 2)
        }
        return this.punct(TokenKind.Pipe, start, 1)
      case '&':
        if (this.src.charAt(this.pos + 1) === '&') {
          if (this.src.charAt(this.pos + 2) === '=') return this.punct(TokenKind.AndAndEq, start, 3)
          return this.punct(TokenKind.AndAnd, start, 2)
        }
        return this.punct(TokenKind.Amp, start, 1)
      case ';':
        return this.punct(TokenKind.Semi, start, 1)
      case '?':
        if (this.src.charAt(this.pos + 1) === '?') {
          if (this.src.charAt(this.pos + 2) === '=') return this.punct(TokenKind.QuestionQuestionEq, start, 3)
          return this.punct(TokenKind.QuestionQuestion, start, 2)
        }
        if (this.src.charAt(this.pos + 1) === '.') {
          return this.punct(TokenKind.QuestionDot, start, 2)
        }
        return this.punct(TokenKind.Question, start, 1)
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

  /** `/pattern/flags` regex literal. Tracks character classes (`[…]`)
   *  so a `/` inside a class (`[a-z/]`) doesn't close the literal,
   *  and respects backslash escapes. After the closing `/`, collects
   *  any trailing flag letters. */
  private lexRegex(start: number): Token {
    this.pos++ // skip the opening `/`
    let inClass = false
    while (this.pos < this.src.length) {
      const ch = this.src.charAt(this.pos)
      if (ch === '\\') {
        // Skip the next char (escape sequence — could be a newline,
        // we tolerate it, JS does too as long as it's escaped).
        this.pos += 2
        continue
      }
      if (ch === '[') inClass = true
      else if (ch === ']') inClass = false
      else if (ch === '/' && !inClass) {
        this.pos++ // consume closing `/`
        // Collect flags.
        while (this.pos < this.src.length) {
          const c = this.src.charAt(this.pos)
          if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) this.pos++
          else break
        }
        return {
          kind: TokenKind.Regex,
          text: this.src.slice(start, this.pos),
          start,
          end: this.pos,
        }
      } else if (ch === '\n') {
        // JS forbids unescaped newlines in regex literals.
        throw new SyntaxError(
          formatError(this.src, this.pos, 'unterminated regex literal (newline before /)', this.filename)
        )
      }
      this.pos++
    }
    throw new SyntaxError(
      formatError(this.src, start, 'unterminated regex literal', this.filename)
    )
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
      // If unclosed, fall through and keep scanning instead of bailing
      // (otherwise an unbalanced fence in user content would prematurely
      // end the markdown body and cascade into a parser error).
      if (
        ch === '`' &&
        this.src.charAt(this.pos + 1) === '`' &&
        this.src.charAt(this.pos + 2) === '`'
      ) {
        const close = this.src.indexOf('```', this.pos + 3)
        if (close < 0) {
          // Unclosed fence — treat the three backticks as regular text.
          this.pos += 3
          continue
        }
        this.pos = close + 3
        continue
      }
      // Inline `code` — skip to the closing backtick on the same line
      // only (CommonMark inline code spans don't cross blank lines).
      // If no close exists, treat the single ` as a regular character.
      if (ch === '`') {
        const lineEnd = this.src.indexOf('\n', this.pos + 1)
        const searchEnd = lineEnd < 0 ? this.src.length : lineEnd
        const close = this.src.indexOf('`', this.pos + 1)
        if (close < 0 || close > searchEnd) {
          this.pos++
          continue
        }
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
