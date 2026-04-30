import type {
  Block,
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

  private parseExpr(): Expr {
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
      const next = this.peek().kind
      if (next === TokenKind.LParen || next === TokenKind.LBrace) {
        return this.parseTagCall(t.text)
      }
      return { kind: 'Ident', name: t.text } satisfies Ident
    }
    throw this.error(`unexpected token ${TokenKind[t.kind]}`)
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

  private parseProp(): Prop {
    const name = this.expect(TokenKind.Ident).text
    this.expect(TokenKind.Colon)
    const value = this.parsePrimary()
    return { name, value }
  }

  private parseChild(): Child {
    const t = this.peek()
    if (t.kind === TokenKind.String) {
      this.pos++
      return { kind: 'StringLit', value: t.value as string }
    }
    if (t.kind === TokenKind.Number) {
      this.pos++
      return { kind: 'NumberLit', value: t.value as number }
    }
    if (t.kind === TokenKind.Ident) {
      this.pos++
      const next = this.peek().kind
      if (next === TokenKind.LParen || next === TokenKind.LBrace) {
        return this.parseTagCall(t.text)
      }
      return { kind: 'Ident', name: t.text }
    }
    throw this.error(`unexpected child token ${TokenKind[t.kind]}`)
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
