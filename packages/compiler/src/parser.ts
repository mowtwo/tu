import type {
  BinaryExpr,
  BinaryOp,
  Block,
  CallExpr,
  Child,
  Expr,
  Ident,
  Lambda,
  LetDecl,
  NumberLit,
  Param,
  Program,
  Prop,
  Stmt,
  StringLit,
  TagCall,
} from './ast.js'
import { TokenKind, type Token } from './tokens.js'

const BINARY_OPS: Partial<Record<TokenKind, { op: BinaryOp; prec: number }>> = {
  [TokenKind.Plus]: { op: '+', prec: 1 },
  [TokenKind.Minus]: { op: '-', prec: 1 },
  [TokenKind.Star]: { op: '*', prec: 2 },
  [TokenKind.Slash]: { op: '/', prec: 2 },
  [TokenKind.Percent]: { op: '%', prec: 2 },
}

export class Parser {
  private pos = 0
  constructor(private readonly tokens: Token[]) {}

  parseProgram(): Program {
    const body: Stmt[] = []
    while (this.peek().kind !== TokenKind.Eof) {
      body.push(this.parseStmt())
    }
    return { kind: 'Program', body }
  }

  private parseStmt(): Stmt {
    if (this.peek().kind === TokenKind.Let) {
      return this.parseLetDecl()
    }
    throw this.error(`expected 'let'`)
  }

  private parseLetDecl(): LetDecl {
    this.expect(TokenKind.Let)
    const name = this.expect(TokenKind.Ident).text
    this.expect(TokenKind.Equals)
    const value = this.parseExpr()
    return { kind: 'LetDecl', exported: true, name, value }
  }

  // Pratt-style precedence climber for binary expressions.
  private parseExpr(): Expr {
    return this.parseBinary(0)
  }

  private parseBinary(minPrec: number): Expr {
    let left = this.parsePrefix()
    while (true) {
      const op = BINARY_OPS[this.peek().kind]
      if (!op || op.prec < minPrec) break
      this.pos++ // consume operator
      const right = this.parseBinary(op.prec + 1)
      left = { kind: 'BinaryExpr', op: op.op, left, right } satisfies BinaryExpr
    }
    return left
  }

  private parsePrefix(): Expr {
    const k = this.peek().kind
    if (k === TokenKind.LParen) return this.parseLambda()
    if (k === TokenKind.LBrace) return this.parseBlock()
    return this.parsePrimary()
  }

  private parseLambda(): Lambda {
    this.expect(TokenKind.LParen)
    const params: Param[] = []
    while (this.peek().kind !== TokenKind.RParen) {
      params.push(this.parseParam())
      if (this.peek().kind === TokenKind.Comma) this.pos++
    }
    this.expect(TokenKind.RParen)
    this.expect(TokenKind.FatArrow)
    const body = this.parseExpr()
    return { kind: 'Lambda', params, body }
  }

  private parseParam(): Param {
    const name = this.expect(TokenKind.Ident).text
    let type: string | undefined
    if (this.peek().kind === TokenKind.Colon) {
      this.pos++
      type = this.expect(TokenKind.Ident).text
    }
    return type === undefined ? { name } : { name, type }
  }

  private parseBlock(): Block {
    this.expect(TokenKind.LBrace)
    const body: Expr[] = []
    while (this.peek().kind !== TokenKind.RBrace) {
      body.push(this.parseExpr())
    }
    this.expect(TokenKind.RBrace)
    return { kind: 'Block', body }
  }

  private parsePrimary(): Expr {
    const t = this.peek()
    if (t.kind === TokenKind.String) {
      this.pos++
      return { kind: 'StringLit', value: t.value as string } satisfies StringLit
    }
    if (t.kind === TokenKind.Number) {
      this.pos++
      return { kind: 'NumberLit', value: t.value as number } satisfies NumberLit
    }
    if (t.kind === TokenKind.Ident) {
      this.pos++
      return this.parseIdentTail(t.text)
    }
    throw this.error(`unexpected token ${TokenKind[t.kind]}`)
  }

  /**
   * After an Ident, decide whether this is:
   *  - bare ident
   *  - TagCall (named-prop call, optionally followed by children block)
   *  - CallExpr (positional-arg call)
   */
  private parseIdentTail(name: string): Expr {
    const next = this.peek().kind
    if (next === TokenKind.LBrace) {
      return this.parseTagCall(name)
    }
    if (next === TokenKind.LParen) {
      const shape = this.peekCallShape()
      if (shape === 'tag') return this.parseTagCall(name)
      return this.parseCallExpr(name)
    }
    return { kind: 'Ident', name } satisfies Ident
  }

  /**
   * Look ahead at args inside `(`. If first arg is `Ident:` it's a tag-call (named props).
   * If parens are empty and `{` follows, it's a tag-call (zero props + children block).
   * Otherwise positional call.
   */
  private peekCallShape(): 'tag' | 'call' {
    const t1 = this.tokens[this.pos + 1]
    if (!t1) return 'call'
    if (t1.kind === TokenKind.RParen) {
      const t2 = this.tokens[this.pos + 2]
      return t2?.kind === TokenKind.LBrace ? 'tag' : 'call'
    }
    const t2 = this.tokens[this.pos + 2]
    if (t1.kind === TokenKind.Ident && t2?.kind === TokenKind.Colon) return 'tag'
    return 'call'
  }

  private parseTagCall(tag: string): TagCall {
    const props: Prop[] = []
    if (this.peek().kind === TokenKind.LParen) {
      this.expect(TokenKind.LParen)
      while (this.peek().kind !== TokenKind.RParen) {
        props.push(this.parseProp())
        if (this.peek().kind === TokenKind.Comma) this.pos++
      }
      this.expect(TokenKind.RParen)
    }
    const children: Child[] = []
    if (this.peek().kind === TokenKind.LBrace) {
      this.expect(TokenKind.LBrace)
      while (this.peek().kind !== TokenKind.RBrace) {
        children.push(this.parseChild())
      }
      this.expect(TokenKind.RBrace)
    }
    return { kind: 'TagCall', tag, props, children }
  }

  private parseCallExpr(callee: string): CallExpr {
    this.expect(TokenKind.LParen)
    const args: Expr[] = []
    while (this.peek().kind !== TokenKind.RParen) {
      args.push(this.parseExpr())
      if (this.peek().kind === TokenKind.Comma) this.pos++
    }
    this.expect(TokenKind.RParen)
    return { kind: 'CallExpr', callee, args }
  }

  private parseProp(): Prop {
    const name = this.expect(TokenKind.Ident).text
    this.expect(TokenKind.Colon)
    const value = this.parsePrimary()
    return { name, value }
  }

  private parseChild(): Child {
    // Children can be any expression except lambdas or bare blocks.
    // Using parseExpr lets binary arithmetic (e.g. `count + 1`) appear inline.
    const e = this.parseExpr()
    if (e.kind === 'Lambda' || e.kind === 'Block') {
      throw this.error(`unexpected ${e.kind} as child`)
    }
    return e
  }

  private peek(): Token {
    const t = this.tokens[this.pos]
    if (!t) throw new Error('parser ran past end of tokens')
    return t
  }

  private expect(kind: TokenKind): Token {
    const t = this.peek()
    if (t.kind !== kind) {
      throw this.error(`expected ${TokenKind[kind]}, got ${TokenKind[t.kind]} (${JSON.stringify(t.text)})`)
    }
    this.pos++
    return t
  }

  private error(msg: string): SyntaxError {
    const t = this.peek()
    return new SyntaxError(`${msg} at offset ${t.start}`)
  }
}

export function parse(tokens: Token[]): Program {
  return new Parser(tokens).parseProgram()
}
