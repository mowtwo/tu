import type {
  ArrayLit,
  AssignExpr,
  BinaryExpr,
  BinaryOp,
  Block,
  BlockItem,
  CallExpr,
  Child,
  ClassRef,
  Expr,
  ForExpr,
  Ident,
  IfExpr,
  ImportDecl,
  Lambda,
  LetDecl,
  LocalLet,
  NumberLit,
  MemberExpr,
  ObjectLit,
  ObjectProp,
  Param,
  Program,
  Prop,
  ReExportDecl,
  Stmt,
  StringLit,
  StyleBlock,
  TagCall,
  TypeAlias,
} from './ast.js'
import { formatError } from './diagnostics.js'
import { TokenKind, type Token } from './tokens.js'

const BINARY_OPS: Partial<Record<TokenKind, { op: BinaryOp; prec: number }>> = {
  // Equality (lowest)
  [TokenKind.EqEq]: { op: '==', prec: 1 },
  [TokenKind.NotEq]: { op: '!=', prec: 1 },
  // Relational
  [TokenKind.Lt]: { op: '<', prec: 2 },
  [TokenKind.LtEq]: { op: '<=', prec: 2 },
  [TokenKind.Gt]: { op: '>', prec: 2 },
  [TokenKind.GtEq]: { op: '>=', prec: 2 },
  // Additive
  [TokenKind.Plus]: { op: '+', prec: 3 },
  [TokenKind.Minus]: { op: '-', prec: 3 },
  // Multiplicative (highest)
  [TokenKind.Star]: { op: '*', prec: 4 },
  [TokenKind.Slash]: { op: '/', prec: 4 },
  [TokenKind.Percent]: { op: '%', prec: 4 },
}

export class Parser {
  private pos = 0
  /**
   * When true, a `{` after an identifier or in prefix position is NOT treated as the
   * start of a tag-call children block (or bare block) — it terminates the current
   * expression instead. Used while parsing the `iter` expression of a `for` loop, where
   * the trailing block is the loop body, not a tag-call on `iter`.
   */
  private noBraceBlock = false
  constructor(
    private readonly tokens: Token[],
    private readonly source: string = '',
    private readonly filename?: string
  ) {}

  parseProgram(): Program {
    const body: Stmt[] = []
    while (this.peek().kind !== TokenKind.Eof) {
      body.push(this.parseStmt())
    }
    return { kind: 'Program', body }
  }

  private parseStmt(): Stmt {
    const start = this.peek().start
    if (this.peek().kind === TokenKind.Import) {
      return this.parseImportDecl(start)
    }
    let exported = false
    if (this.peek().kind === TokenKind.Export) {
      this.pos++
      exported = true
      // `export { … } from "…"` re-export form.
      if (this.peek().kind === TokenKind.LBrace) {
        return this.parseReExportDecl(start)
      }
      // `export type X = …` — type alias.
      if (this.isTypeAliasNext()) {
        return this.parseTypeAlias(start, true)
      }
    }
    if (this.peek().kind === TokenKind.Let) {
      return this.parseLetDecl(start, exported)
    }
    if (this.isTypeAliasNext()) {
      return this.parseTypeAlias(start, exported)
    }
    throw this.error(
      `expected 'let', 'export let', 'type', 'export type', 'import', or 'export {…} from …'`
    )
  }

  /**
   * `type` is a contextual keyword: it's treated as a type-alias introducer
   * only when followed by `Ident =`. Anywhere else (a value reference, a
   * lambda param name) the lexer's plain `Ident` token wins. Mirrors how
   * TypeScript / Swift handle it.
   */
  private isTypeAliasNext(): boolean {
    const t1 = this.peek()
    if (t1.kind !== TokenKind.Ident || t1.text !== 'type') return false
    const t2 = this.tokens[this.pos + 1]
    if (t2?.kind !== TokenKind.Ident) return false
    const t3 = this.tokens[this.pos + 2]
    return t3?.kind === TokenKind.Equals
  }

  private parseTypeAlias(start: number, exported: boolean): TypeAlias {
    this.pos++ // consume the contextual `type` ident
    const nameTok = this.expect(TokenKind.Ident)
    this.expect(TokenKind.Equals)
    const span = this.parseRawTypeUntilStmtBoundary()
    return {
      kind: 'TypeAlias',
      exported,
      name: nameTok.text,
      type: span.text,
      start,
      end: span.end,
      nameStart: nameTok.start,
      nameEnd: nameTok.end,
      typeStart: span.start,
      typeEnd: span.end,
    }
  }

  /**
   * Read tokens until the next top-level statement (or EOF), tracking nesting
   * across `()` / `{}` / `[]` / `<…>`. Top-level boundary tokens are `let`,
   * `export`, `import`, or a contextual `type`-alias-start. Returns the raw
   * source slice — the TS compiler does the actual type parsing.
   */
  private parseRawTypeUntilStmtBoundary(): { text: string; start: number; end: number } {
    const start = this.peek().start
    let depth = 0
    let end = start
    while (true) {
      const t = this.peek()
      if (t.kind === TokenKind.Eof) break
      if (depth === 0) {
        if (
          t.kind === TokenKind.Let ||
          t.kind === TokenKind.Export ||
          t.kind === TokenKind.Import
        ) {
          break
        }
        // Another contextual `type X = …` starting.
        if (t.kind === TokenKind.Ident && t.text === 'type') {
          const t2 = this.tokens[this.pos + 1]
          const t3 = this.tokens[this.pos + 2]
          if (t2?.kind === TokenKind.Ident && t3?.kind === TokenKind.Equals) break
        }
      }
      if (
        t.kind === TokenKind.LParen ||
        t.kind === TokenKind.LBrace ||
        t.kind === TokenKind.LBracket ||
        t.kind === TokenKind.Lt
      ) {
        depth++
      } else if (
        t.kind === TokenKind.RParen ||
        t.kind === TokenKind.RBrace ||
        t.kind === TokenKind.RBracket ||
        t.kind === TokenKind.Gt
      ) {
        depth--
      }
      end = t.end
      this.pos++
    }
    return { text: this.source.slice(start, end).trim(), start, end }
  }

  private parseImportDecl(start: number): ImportDecl {
    this.expect(TokenKind.Import)
    this.expect(TokenKind.LBrace)
    const names: string[] = []
    while (this.peek().kind !== TokenKind.RBrace) {
      names.push(this.expect(TokenKind.Ident).text)
      if (this.peek().kind === TokenKind.Comma) this.pos++
    }
    this.expect(TokenKind.RBrace)
    this.expect(TokenKind.From)
    const sourceTok = this.expect(TokenKind.String)
    return {
      kind: 'ImportDecl',
      names,
      source: sourceTok.value as string,
      start,
      end: sourceTok.end,
    }
  }

  private parseReExportDecl(start: number): ReExportDecl {
    this.expect(TokenKind.LBrace)
    const names: string[] = []
    while (this.peek().kind !== TokenKind.RBrace) {
      names.push(this.expect(TokenKind.Ident).text)
      if (this.peek().kind === TokenKind.Comma) this.pos++
    }
    this.expect(TokenKind.RBrace)
    this.expect(TokenKind.From)
    const sourceTok = this.expect(TokenKind.String)
    return {
      kind: 'ReExportDecl',
      names,
      source: sourceTok.value as string,
      start,
      end: sourceTok.end,
    }
  }

  private parseLetDecl(start: number, exported: boolean): LetDecl {
    this.expect(TokenKind.Let)
    const nameTok = this.expect(TokenKind.Ident)
    let type: string | undefined
    let typeStart: number | undefined
    let typeEnd: number | undefined
    if (this.peek().kind === TokenKind.Colon) {
      this.pos++
      const span = this.parseRawTypeUntilEquals()
      type = span.text
      typeStart = span.start
      typeEnd = span.end
    }
    this.expect(TokenKind.Equals)
    const value = this.parseExpr()
    const decl: LetDecl = {
      kind: 'LetDecl',
      exported,
      name: nameTok.text,
      value,
      start,
      end: value.end,
      nameStart: nameTok.start,
      nameEnd: nameTok.end,
    }
    if (type !== undefined) {
      decl.type = type
      decl.typeStart = typeStart!
      decl.typeEnd = typeEnd!
    }
    return decl
  }

  /**
   * Read tokens until the top-level `=` that opens the let-decl's RHS, while
   * tracking nesting depth across `()` / `{}` / `<…>` so a generic argument
   * with a default (rare in TS, theoretically possible) doesn't terminate
   * the type early. Returns the raw source slice — Tu doesn't parse types
   * itself; the TS compiler does.
   */
  private parseRawTypeUntilEquals(): { text: string; start: number; end: number } {
    const start = this.peek().start
    let depth = 0
    let end = start
    while (true) {
      const t = this.peek()
      if (t.kind === TokenKind.Eof) {
        throw this.error(`unexpected EOF in type annotation`)
      }
      if (depth === 0 && t.kind === TokenKind.Equals) break
      if (
        t.kind === TokenKind.LParen ||
        t.kind === TokenKind.LBrace ||
        t.kind === TokenKind.LBracket ||
        t.kind === TokenKind.Lt
      ) {
        depth++
      } else if (
        t.kind === TokenKind.RParen ||
        t.kind === TokenKind.RBrace ||
        t.kind === TokenKind.RBracket ||
        t.kind === TokenKind.Gt
      ) {
        depth--
      }
      end = t.end
      this.pos++
    }
    return { text: this.source.slice(start, end).trim(), start, end }
  }

  // Pratt-style precedence climber for binary expressions, with a
  // top-level assignment hook: `Ident = expr` parses as AssignExpr. This is
  // the only way Tu source mutates a state cell — codegen rewrites
  // `target = expr` to `target.set(expr)` when target resolves to a cell.
  private parseExpr(): Expr {
    if (this.peek().kind === TokenKind.Ident) {
      const next = this.tokens[this.pos + 1]
      if (next?.kind === TokenKind.Equals) {
        const targetTok = this.peek()
        this.pos += 2 // consume Ident and Equals
        const value = this.parseExpr()
        return {
          kind: 'AssignExpr',
          target: targetTok.text,
          value,
          start: targetTok.start,
          end: value.end,
          targetStart: targetTok.start,
          targetEnd: targetTok.end,
        } satisfies AssignExpr
      }
    }
    return this.parseBinary(0)
  }

  private parseBinary(minPrec: number): Expr {
    let left = this.parsePostfix(this.parsePrefix())
    while (true) {
      const op = BINARY_OPS[this.peek().kind]
      if (!op || op.prec < minPrec) break
      this.pos++ // consume operator
      const right = this.parseBinary(op.prec + 1)
      left = {
        kind: 'BinaryExpr',
        op: op.op,
        left,
        right,
        start: left.start,
        end: right.end,
      } satisfies BinaryExpr
    }
    return left
  }

  /**
   * Postfix loop: `expr.x.y` → a left-leaning `MemberExpr` chain.
   *
   * Only applied to **value-yielding** expr kinds (Ident, plain CallExpr,
   * existing MemberExpr, ObjectLit, ArrayLit). Crucially **NOT** to
   * TagCall / IfExpr / Block / Lambda / etc. — Tu's children are
   * whitespace-separated, so without this restriction a sequence like:
   *
   *     div { x }
   *     .body() { y }
   *
   * would greedily attach the second statement's prefix dot to the first
   * statement's TagCall as `(div { x }).body() { y }` — a member access
   * on a vnode, which is never what the user means. The whitelist
   * mirrors JS's intuition: dotting onto a tag literal makes no sense.
   *
   * Component invocations with a trailing children block
   * (`Card("hi") { … }`) are also excluded — that result is a vnode, not
   * a plain value.
   *
   * Class-binding values (`class: .card`) keep their existing meaning
   * because the starter Dot is consumed at parse-PREFIX time by
   * `parseClassRefOrPugShorthand`, not here.
   */
  private parsePostfix(expr: Expr): Expr {
    while (true) {
      if (this.peek().kind !== TokenKind.Dot) return expr
      if (!isMemberAccessibleExpr(expr)) return expr
      const next = this.tokens[this.pos + 1]
      if (next?.kind !== TokenKind.Ident) return expr
      this.pos++ // consume the dot
      const propTok = this.expect(TokenKind.Ident)
      expr = {
        kind: 'MemberExpr',
        object: expr,
        property: propTok.text,
        start: expr.start,
        end: propTok.end,
        propertyStart: propTok.start,
        propertyEnd: propTok.end,
      } satisfies MemberExpr
    }
  }

  private parsePrefix(): Expr {
    const k = this.peek().kind
    if (k === TokenKind.LParen) return this.parseLambda()
    if (k === TokenKind.LBrace && !this.noBraceBlock) {
      return this.peekObjectLitShape() ? this.parseObjectLit() : this.parseBlock()
    }
    if (k === TokenKind.LBracket) return this.parseArrayLit()
    if (k === TokenKind.If) return this.parseIfExpr()
    if (k === TokenKind.For) return this.parseForExpr()
    if (k === TokenKind.Dot) return this.parseClassRefOrPugShorthand()
    return this.parsePrimary()
  }

  /**
   * Decide whether a `{` at the current position opens an ObjectLit instead
   * of a Block. Triggered by:
   *   `{ }`              — empty object literal (Block-as-undefined was an
   *                        unused shape)
   *   `{ Ident :`        — `{ x: 1 }`
   *   `{ String :`       — `{ "data-id": 1 }`
   * Anything else (including `{ x }`, `{ let y = 1; y }`, `{ tag(...) }`)
   * stays a Block. Shorthand / computed-key / spread shapes parse as Block
   * today and are tracked in docs/DEFERRED.md.
   */
  private peekObjectLitShape(): boolean {
    const t1 = this.tokens[this.pos + 1]
    if (!t1) return false
    if (t1.kind === TokenKind.RBrace) return true
    const t2 = this.tokens[this.pos + 2]
    if (!t2 || t2.kind !== TokenKind.Colon) return false
    return t1.kind === TokenKind.Ident || t1.kind === TokenKind.String
  }

  private parseObjectLit(): ObjectLit {
    const lbrace = this.expect(TokenKind.LBrace)
    const properties: ObjectProp[] = []
    while (this.peek().kind !== TokenKind.RBrace) {
      properties.push(this.parseObjectProp())
      if (this.peek().kind === TokenKind.Comma) this.pos++
    }
    const rbrace = this.expect(TokenKind.RBrace)
    return {
      kind: 'ObjectLit',
      properties,
      start: lbrace.start,
      end: rbrace.end,
    }
  }

  private parseObjectProp(): ObjectProp {
    const keyTok = this.peek()
    let key: string
    let keyKind: 'ident' | 'string'
    if (keyTok.kind === TokenKind.Ident) {
      key = keyTok.text
      keyKind = 'ident'
    } else if (keyTok.kind === TokenKind.String) {
      key = keyTok.value as string
      keyKind = 'string'
    } else {
      throw this.error(`expected object-literal key (identifier or string), got ${TokenKind[keyTok.kind]}`)
    }
    this.pos++
    this.expect(TokenKind.Colon)
    const value = this.parseExpr()
    return {
      key,
      keyKind,
      value,
      keyStart: keyTok.start,
      keyEnd: keyTok.end,
    }
  }

  private parseArrayLit(): ArrayLit {
    const lbracket = this.expect(TokenKind.LBracket)
    const elements: Expr[] = []
    while (this.peek().kind !== TokenKind.RBracket) {
      elements.push(this.parseExpr())
      if (this.peek().kind === TokenKind.Comma) this.pos++
    }
    const rbracket = this.expect(TokenKind.RBracket)
    return {
      kind: 'ArrayLit',
      elements,
      start: lbracket.start,
      end: rbracket.end,
    }
  }

  /**
   * Parse a `.foo[.bar.baz…]` form. Shapes:
   *   `.foo`           → ClassRef (used as e.g. `class: .foo`)
   *   `.foo.bar`       → space-joined class binding (BinaryExpr chain)
   *   `.foo(...)`      → pug-shorthand tag-call: desugars to `div(class: .foo, ...)`
   *   `.foo.bar(...)`  → pug-shorthand tag-call with multi-class binding
   *   `.foo { ... }`   → pug-shorthand tag-call with no extra props
   *   `.foo(tag: "section")` → pug-shorthand with overridden tag (default `div`)
   *
   * In the pug-shorthand cases, an explicit `class:` prop in the args is a
   * compile error — the shorthand already binds class. The `tag:` prop is
   * special-cased: it's extracted from the args (must be a string literal)
   * and becomes the synthetic TagCall's tag.
   */
  private parseClassRefOrPugShorthand(): Expr {
    const refs = this.parseClassRefChain()
    const next = this.peek().kind
    if (next === TokenKind.LParen || (next === TokenKind.LBrace && !this.noBraceBlock)) {
      return this.parsePugShorthandTail(refs)
    }
    return joinClassRefs(refs)
  }

  /** Greedy chain: `.foo.bar.baz` → three ClassRefs. Caller decides how to use them. */
  private parseClassRefChain(): ClassRef[] {
    const refs: ClassRef[] = []
    do {
      const dotTok = this.expect(TokenKind.Dot)
      const nameTok = this.expect(TokenKind.Ident)
      refs.push({
        kind: 'ClassRef',
        name: nameTok.text,
        start: dotTok.start,
        end: nameTok.end,
      })
    } while (this.peek().kind === TokenKind.Dot)
    return refs
  }

  private parsePugShorthandTail(classRefs: ClassRef[]): TagCall {
    const classExpr = joinClassRefs(classRefs)
    const props: Prop[] = [{ name: 'class', value: classExpr }]
    let tag = 'div'
    let tagStart = classRefs[0]!.start
    let tagEnd = classRefs[0]!.end
    if (this.peek().kind === TokenKind.LParen) {
      this.expect(TokenKind.LParen)
      while (this.peek().kind !== TokenKind.RParen) {
        const p = this.parseProp()
        if (p.name === 'class') {
          throw this.error(`pug-shorthand .${classRefs[0]!.name}(...) already binds class:; remove the explicit class prop`)
        }
        if (p.name === 'tag') {
          if (p.value.kind !== 'StringLit') {
            throw this.error(`pug-shorthand tag: prop must be a string literal (e.g. tag: "section")`)
          }
          tag = p.value.value
          tagStart = p.value.start
          tagEnd = p.value.end
        } else {
          props.push(p)
        }
        if (this.peek().kind === TokenKind.Comma) this.pos++
      }
      this.expect(TokenKind.RParen)
    }
    const children: Child[] = []
    let endTok: Token
    if (this.peek().kind === TokenKind.LBrace) {
      this.expect(TokenKind.LBrace)
      while (this.peek().kind !== TokenKind.RBrace) {
        children.push(this.parseChild())
      }
      endTok = this.expect(TokenKind.RBrace)
    } else {
      // Tail paren is required if no children; the previous expect(RParen) gives the close.
      endTok = this.tokens[this.pos - 1]!
    }
    return {
      kind: 'TagCall',
      tag,
      props,
      children,
      start: classRefs[0]!.start,
      end: endTok.end,
      tagStart,
      tagEnd,
    }
  }

  private parseLambda(): Lambda {
    const lparen = this.expect(TokenKind.LParen)
    const params: Param[] = []
    while (this.peek().kind !== TokenKind.RParen) {
      params.push(this.parseParam())
      if (this.peek().kind === TokenKind.Comma) this.pos++
    }
    this.expect(TokenKind.RParen)
    let returnType: string | undefined
    let returnTypeStart: number | undefined
    let returnTypeEnd: number | undefined
    if (this.peek().kind === TokenKind.Colon) {
      this.pos++
      const span = this.parseRawTypeUntilFatArrow()
      returnType = span.text
      returnTypeStart = span.start
      returnTypeEnd = span.end
    }
    this.expect(TokenKind.FatArrow)
    const body = this.parseExpr()
    const lambda: Lambda = {
      kind: 'Lambda',
      params,
      body,
      start: lparen.start,
      end: body.end,
    }
    if (returnType !== undefined) {
      lambda.returnType = returnType
      lambda.returnTypeStart = returnTypeStart!
      lambda.returnTypeEnd = returnTypeEnd!
    }
    return lambda
  }

  /**
   * Same depth-tracked raw-type read as `parseRawTypeUntilEquals`, but the
   * terminator is `=>` (FatArrow) at depth 0. Used by the optional
   * lambda return-type annotation: `(x: number): string => …`.
   */
  private parseRawTypeUntilFatArrow(): { text: string; start: number; end: number } {
    const start = this.peek().start
    let depth = 0
    let end = start
    while (true) {
      const t = this.peek()
      if (t.kind === TokenKind.Eof) {
        throw this.error(`unexpected EOF in lambda return-type annotation`)
      }
      if (depth === 0 && t.kind === TokenKind.FatArrow) break
      if (
        t.kind === TokenKind.LParen ||
        t.kind === TokenKind.LBrace ||
        t.kind === TokenKind.LBracket ||
        t.kind === TokenKind.Lt
      ) {
        depth++
      } else if (
        t.kind === TokenKind.RParen ||
        t.kind === TokenKind.RBrace ||
        t.kind === TokenKind.RBracket ||
        t.kind === TokenKind.Gt
      ) {
        depth--
      }
      end = t.end
      this.pos++
    }
    return { text: this.source.slice(start, end).trim(), start, end }
  }

  private parseParam(): Param {
    const nameTok = this.expect(TokenKind.Ident)
    let type: string | undefined
    let endOffset = nameTok.end
    if (this.peek().kind === TokenKind.Colon) {
      this.pos++
      const span = this.parseRawTypeUntilParamBoundary()
      type = span.text
      endOffset = span.end
    }
    return type === undefined
      ? {
          name: nameTok.text,
          start: nameTok.start,
          end: endOffset,
          nameStart: nameTok.start,
          nameEnd: nameTok.end,
        }
      : {
          name: nameTok.text,
          type,
          start: nameTok.start,
          end: endOffset,
          nameStart: nameTok.start,
          nameEnd: nameTok.end,
        }
  }

  /**
   * Same depth-tracked raw-type read as `parseRawTypeUntilEquals`, but the
   * terminators are the param-list separators: `,` and `)` at depth 0.
   * Lets users write rich param types: `(items: VNode[])`,
   * `(cb: (x: number) => string)`, `(opts: { force?: boolean })`.
   */
  private parseRawTypeUntilParamBoundary(): { text: string; start: number; end: number } {
    const start = this.peek().start
    let depth = 0
    let end = start
    while (true) {
      const t = this.peek()
      if (t.kind === TokenKind.Eof) {
        throw this.error(`unexpected EOF in param type annotation`)
      }
      if (depth === 0 && (t.kind === TokenKind.Comma || t.kind === TokenKind.RParen)) {
        break
      }
      if (
        t.kind === TokenKind.LParen ||
        t.kind === TokenKind.LBrace ||
        t.kind === TokenKind.LBracket ||
        t.kind === TokenKind.Lt
      ) {
        depth++
      } else if (
        t.kind === TokenKind.RParen ||
        t.kind === TokenKind.RBrace ||
        t.kind === TokenKind.RBracket ||
        t.kind === TokenKind.Gt
      ) {
        depth--
      }
      end = t.end
      this.pos++
    }
    return { text: this.source.slice(start, end).trim(), start, end }
  }

  private parseBlock(): Block {
    const lbrace = this.expect(TokenKind.LBrace)
    const body: BlockItem[] = []
    while (this.peek().kind !== TokenKind.RBrace) {
      // Tolerate optional `;` as a statement separator (M2.4 token, kept
      // a no-op for ergonomic inline lambdas).
      if (this.peek().kind === TokenKind.Semi) {
        this.pos++
        continue
      }
      // Local `let` (M5.2): `let x = expr` declares a block-scoped const.
      if (this.peek().kind === TokenKind.Let) {
        body.push(this.parseLocalLet())
        continue
      }
      body.push(this.parseExpr())
    }
    const rbrace = this.expect(TokenKind.RBrace)
    return {
      kind: 'Block',
      body,
      start: lbrace.start,
      end: rbrace.end,
    }
  }

  private parseLocalLet(): LocalLet {
    const letTok = this.expect(TokenKind.Let)
    const nameTok = this.expect(TokenKind.Ident)
    let type: string | undefined
    let typeStart: number | undefined
    let typeEnd: number | undefined
    if (this.peek().kind === TokenKind.Colon) {
      this.pos++
      const span = this.parseRawTypeUntilEquals()
      type = span.text
      typeStart = span.start
      typeEnd = span.end
    }
    this.expect(TokenKind.Equals)
    const value = this.parseExpr()
    const out: LocalLet = {
      kind: 'LocalLet',
      name: nameTok.text,
      value,
      start: letTok.start,
      end: value.end,
      nameStart: nameTok.start,
      nameEnd: nameTok.end,
    }
    if (type !== undefined) {
      out.type = type
      out.typeStart = typeStart!
      out.typeEnd = typeEnd!
    }
    return out
  }

  private parseIfExpr(): IfExpr {
    const ifTok = this.expect(TokenKind.If)
    this.expect(TokenKind.LParen)
    const cond = this.parseExpr()
    this.expect(TokenKind.RParen)
    const then = this.parseBlock()
    let elseBranch: Block | IfExpr | undefined
    if (this.peek().kind === TokenKind.Else) {
      this.pos++
      if (this.peek().kind === TokenKind.If) {
        elseBranch = this.parseIfExpr()
      } else {
        elseBranch = this.parseBlock()
      }
    }
    const end = elseBranch ? elseBranch.end : then.end
    return elseBranch === undefined
      ? { kind: 'IfExpr', cond, then, start: ifTok.start, end }
      : { kind: 'IfExpr', cond, then, else: elseBranch, start: ifTok.start, end }
  }

  private parseForExpr(): ForExpr {
    const forTok = this.expect(TokenKind.For)
    const itemTok = this.expect(TokenKind.Ident)
    this.expect(TokenKind.In)
    // Suppress trailing-brace block during iter parsing so that
    // `for x in items { body }` doesn't treat `items { body }` as a tag-call.
    const prev = this.noBraceBlock
    this.noBraceBlock = true
    let iter: Expr
    try {
      iter = this.parseExpr()
    } finally {
      this.noBraceBlock = prev
    }
    const body = this.parseBlock()
    return {
      kind: 'ForExpr',
      item: itemTok.text,
      iter,
      body,
      start: forTok.start,
      end: body.end,
      itemStart: itemTok.start,
      itemEnd: itemTok.end,
    }
  }

  private parsePrimary(): Expr {
    const t = this.peek()
    if (t.kind === TokenKind.String) {
      this.pos++
      return {
        kind: 'StringLit',
        value: t.value as string,
        start: t.start,
        end: t.end,
      } satisfies StringLit
    }
    if (t.kind === TokenKind.Number) {
      this.pos++
      return {
        kind: 'NumberLit',
        value: t.value as number,
        start: t.start,
        end: t.end,
      } satisfies NumberLit
    }
    if (t.kind === TokenKind.Ident) {
      this.pos++
      return this.parseIdentTail(t)
    }
    throw this.error(`unexpected token ${TokenKind[t.kind]}`)
  }

  /**
   * After an Ident, decide whether this is:
   *  - bare ident
   *  - HTML tag-call (lowercase callee + named-prop call, optionally
   *    followed by a children block) → `h("tag", props, children)`
   *  - Component invocation (capitalized callee) → `Callee(args, [children])`
   *  - Plain function call (lowercase callee + positional args, no children)
   *
   * Capitalization is the discriminator between HTML tags and user
   * components, mirroring the React/JSX convention. The split matters
   * because user components are real functions — tsserver sees them as
   * such, so hover / goto-definition / completion all work in IDEs.
   */
  private parseIdentTail(nameTok: Token): Expr {
    const name = nameTok.text
    const next = this.peek().kind
    const isComponent = isCapitalizedIdent(name)
    if (next === TokenKind.LBrace && !this.noBraceBlock) {
      // `style { … }` (no parens) is a special-form CSS block; the lexer has
      // already tokenized the body as a single CssText.
      if (name === 'style' && this.tokens[this.pos + 1]?.kind === TokenKind.CssText) {
        return this.parseStyleBlock(nameTok)
      }
      if (isComponent) return this.parseComponentCall(nameTok, /* hasParens */ false)
      return this.parseTagCall(nameTok)
    }
    if (next === TokenKind.LParen) {
      if (isComponent) return this.parseComponentCall(nameTok, /* hasParens */ true)
      const shape = this.peekCallShape()
      if (shape === 'tag') return this.parseTagCall(nameTok)
      return this.parseCallExpr(nameTok)
    }
    return {
      kind: 'Ident',
      name,
      start: nameTok.start,
      end: nameTok.end,
    } satisfies Ident
  }

  /**
   * Parse a component invocation: `Callee([args]) [{ children }]`. Both
   * the args list and the children block are optional independently.
   * Lowers to a `CallExpr` whose `children` (if present) the codegen
   * emits as the last positional argument array.
   */
  private parseComponentCall(nameTok: Token, hasParens: boolean): CallExpr {
    const args: Expr[] = []
    let endTok: Token = nameTok
    if (hasParens) {
      this.expect(TokenKind.LParen)
      while (this.peek().kind !== TokenKind.RParen) {
        args.push(this.parseExpr())
        if (this.peek().kind === TokenKind.Comma) this.pos++
      }
      endTok = this.expect(TokenKind.RParen)
    }
    let children: Child[] | undefined
    if (this.peek().kind === TokenKind.LBrace && !this.noBraceBlock) {
      this.expect(TokenKind.LBrace)
      children = []
      while (this.peek().kind !== TokenKind.RBrace) {
        children.push(this.parseChild())
      }
      endTok = this.expect(TokenKind.RBrace)
    }
    const result: CallExpr = {
      kind: 'CallExpr',
      callee: nameTok.text,
      args,
      start: nameTok.start,
      end: endTok.end,
      calleeStart: nameTok.start,
      calleeEnd: nameTok.end,
    }
    if (children !== undefined) result.children = children
    return result
  }

  private parseStyleBlock(styleTok: Token): StyleBlock {
    this.expect(TokenKind.LBrace)
    const cssTok = this.expect(TokenKind.CssText)
    const css = cssTok.value as string
    const rbrace = this.expect(TokenKind.RBrace)
    return {
      kind: 'StyleBlock',
      css,
      start: styleTok.start,
      end: rbrace.end,
      cssStart: cssTok.start,
      cssEnd: cssTok.end,
    }
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

  private parseTagCall(tagTok: Token): TagCall {
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
    let endOffset = this.tokens[this.pos - 1]!.end
    if (this.peek().kind === TokenKind.LBrace) {
      this.expect(TokenKind.LBrace)
      while (this.peek().kind !== TokenKind.RBrace) {
        children.push(this.parseChild())
      }
      endOffset = this.expect(TokenKind.RBrace).end
    }
    return {
      kind: 'TagCall',
      tag: tagTok.text,
      props,
      children,
      start: tagTok.start,
      end: endOffset,
      tagStart: tagTok.start,
      tagEnd: tagTok.end,
    }
  }

  private parseCallExpr(calleeTok: Token): CallExpr {
    this.expect(TokenKind.LParen)
    const args: Expr[] = []
    while (this.peek().kind !== TokenKind.RParen) {
      args.push(this.parseExpr())
      if (this.peek().kind === TokenKind.Comma) this.pos++
    }
    const rparen = this.expect(TokenKind.RParen)
    return {
      kind: 'CallExpr',
      callee: calleeTok.text,
      args,
      start: calleeTok.start,
      end: rparen.end,
      calleeStart: calleeTok.start,
      calleeEnd: calleeTok.end,
    }
  }

  private parseProp(): Prop {
    const name = this.expect(TokenKind.Ident).text
    this.expect(TokenKind.Colon)
    // Use parseExpr (not parsePrimary) so prop values can be lambdas,
    // arithmetic, conditional expressions, etc. — e.g.
    // `onClick: () => count = count + 1`.
    const value = this.parseExpr()
    return { name, value }
  }

  private parseChild(): Child {
    // Children can be any expression except lambdas, bare blocks, or
    // assignments. Using parseExpr lets binary arithmetic (e.g. `count + 1`)
    // and control-flow expressions (`if`, `for`, `match`) appear inline.
    const e = this.parseExpr()
    if (
      e.kind === 'Lambda' ||
      e.kind === 'Block' ||
      e.kind === 'AssignExpr' ||
      e.kind === 'ObjectLit'
    ) {
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
    return new SyntaxError(formatError(this.source, t.start, msg, this.filename))
  }
}

export function parse(tokens: Token[], source: string = '', filename?: string): Program {
  return new Parser(tokens, source, filename).parseProgram()
}

/**
 * `Card`, `MyButton`, `X` → component (capitalized).
 * `div`, `button`, `_helper`, `count` → HTML tag or plain ident.
 * Strict-capitalized check: ASCII letter A-Z. Non-letter starts (`_`, `$`)
 * fall through to the lowercase path so private-by-convention names don't
 * accidentally become components.
 */
/**
 * True when `expr` produces a value that may meaningfully be dotted into
 * (`obj.x`). False for tag-shaped expressions and statement-shaped
 * expressions whose result is a vnode/control-flow shape — those would
 * silently swallow a following `.classRef` shorthand from the next sibling.
 */
function isMemberAccessibleExpr(expr: Expr): boolean {
  if (expr.kind === 'Ident') return true
  if (expr.kind === 'MemberExpr') return true
  if (expr.kind === 'ObjectLit') return true
  if (expr.kind === 'ArrayLit') return true
  if (expr.kind === 'CallExpr') {
    // A component invocation with a trailing children block yields a
    // vnode, not a plain value — exclude it. Plain function/component
    // calls without children stay accessible.
    return expr.children === undefined
  }
  return false
}

function isCapitalizedIdent(name: string): boolean {
  if (name.length === 0) return false
  const c = name.charCodeAt(0)
  return c >= 0x41 /* A */ && c <= 0x5a /* Z */
}

/**
 * Combine N ClassRefs into a single expression. One ref → bare ClassRef; many
 * refs → a `+` chain interleaved with " " StringLits, which the codegen emits
 * as `("foo-tu-h" + " " + "bar-tu-h")` so the runtime sees a space-joined
 * class string. Anchored on the first ref's source start so error reporting
 * still points at the source.
 */
function joinClassRefs(refs: ClassRef[]): Expr {
  if (refs.length === 1) return refs[0]!
  let acc: Expr = refs[0]!
  for (let i = 1; i < refs.length; i++) {
    const ref = refs[i]!
    const space: StringLit = {
      kind: 'StringLit',
      value: ' ',
      start: ref.start,
      end: ref.start,
    }
    acc = {
      kind: 'BinaryExpr',
      op: '+',
      left: acc,
      right: space,
      start: acc.start,
      end: space.end,
    }
    acc = {
      kind: 'BinaryExpr',
      op: '+',
      left: acc,
      right: ref,
      start: acc.start,
      end: ref.end,
    }
  }
  return acc
}
