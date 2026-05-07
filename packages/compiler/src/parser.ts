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
  ExternalLambda,
  ForExpr,
  Ident,
  IfExpr,
  ExceptionDecl,
  ImportDecl,
  InterfaceDecl,
  InterfaceField,
  Lambda,
  LetDecl,
  LocalLet,
  MarkdownBlock,
  NumberLit,
  MemberExpr,
  MethodCallExpr,
  ObjectLit,
  ObjectMember,
  ObjectProp,
  Param,
  Program,
  Prop,
  ReExportDecl,
  Stmt,
  StringLit,
  StyleBlock,
  TagCall,
  TemplateLit,
  TryCatchClause,
  TryExpr,
  TypeAlias,
} from './ast.js'
import { formatError } from './diagnostics.js'
import { TokenKind, type Token } from './tokens.js'

/**
 * Split a raw type-expression text on the first DEPTH-0 `?` token —
 * Tu's M9 throws-clause separator. Returns `null` when no top-level
 * `?` exists (the whole text is the return type). Tracks `()` / `{}`
 * / `[]` / `<…>` so optional-modifier `?` inside generic args (`Map<K
 * | undefined, V>`) and optional fields inside inline object types
 * (`{ x?: number }`) don't trigger a split.
 *
 * This is regex-friendly enough to live here: Tu type texts are
 * already source slices Tu's lexer captured. We char-walk to keep
 * the depth-tracking honest.
 */
function splitOnTopLevelQuestion(
  text: string
): { before: string; after: string; questionOffset: number } | null {
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i)
    if (c === '(' || c === '[' || c === '{' || c === '<') depth++
    else if (c === ')' || c === ']' || c === '}' || c === '>') depth--
    else if (depth === 0 && c === '?') {
      // Skip optional-chaining `?.` (shouldn't appear at type-level
      // but defensive).
      if (text.charAt(i + 1) === '.') continue
      // The throws-clause separator has whitespace OR identifier on
      // the right immediately. If the next non-space char is `:` it's
      // a TS optional-property in an inline object literal — but those
      // are already inside `{}` so depth>0 here. Safe to split.
      return {
        before: text.slice(0, i).trim(),
        after: text.slice(i + 1).trim(),
        questionOffset: i,
      }
    }
  }
  return null
}

/** Tokens whose presence immediately before a `{` (inside a TS-style
 *  type span) means the `{` opens a TYPE LITERAL, not the body of a
 *  surrounding form. Used by `parseRawTypeUntilBrace` to disambiguate
 *  external-JS return types like `: { ms: number } { ... }` from
 *  regular ones like `: string { ... }`. */
function isTypeContinuationToken(k: TokenKind): boolean {
  return (
    k === TokenKind.Colon ||
    k === TokenKind.Amp ||
    k === TokenKind.Pipe ||
    k === TokenKind.FatArrow ||
    k === TokenKind.Comma ||
    k === TokenKind.LBracket ||
    k === TokenKind.LParen ||
    k === TokenKind.Lt ||
    k === TokenKind.Question
  )
}

const COMPOUND_ASSIGN_OPS: Partial<Record<TokenKind, BinaryOp>> = {
  [TokenKind.PlusEq]: '+',
  [TokenKind.MinusEq]: '-',
  [TokenKind.StarEq]: '*',
  [TokenKind.SlashEq]: '/',
  [TokenKind.PercentEq]: '%',
  [TokenKind.OrOrEq]: '||',
  [TokenKind.AndAndEq]: '&&',
  [TokenKind.QuestionQuestionEq]: '??',
}

const BINARY_OPS: Partial<Record<TokenKind, { op: BinaryOp; prec: number }>> = {
  // Nullish + logical OR (lowest). Same precedence as ||; mixing them
  // would be ambiguous so users will need parens — JS itself disallows
  // `a || b ?? c` without parens at the syntax level. We stay lax and
  // delegate the diagnostic to tsserver in TS-emit mode.
  [TokenKind.QuestionQuestion]: { op: '??', prec: 1 },
  [TokenKind.OrOr]: { op: '||', prec: 1 },
  // Logical AND
  [TokenKind.AndAnd]: { op: '&&', prec: 2 },
  // Equality
  [TokenKind.EqEq]: { op: '==', prec: 3 },
  [TokenKind.NotEq]: { op: '!=', prec: 3 },
  // Relational
  [TokenKind.Lt]: { op: '<', prec: 4 },
  [TokenKind.LtEq]: { op: '<=', prec: 4 },
  [TokenKind.Gt]: { op: '>', prec: 4 },
  [TokenKind.GtEq]: { op: '>=', prec: 4 },
  // Additive
  [TokenKind.Plus]: { op: '+', prec: 5 },
  [TokenKind.Minus]: { op: '-', prec: 5 },
  // Multiplicative (highest)
  [TokenKind.Star]: { op: '*', prec: 6 },
  [TokenKind.Slash]: { op: '/', prec: 6 },
  [TokenKind.Percent]: { op: '%', prec: 6 },
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
      // `export interface X { … }` — M8 interface decl.
      if (this.isInterfaceNext()) {
        return this.parseInterfaceDecl(start, true)
      }
      // `export Exception X { … }` — structured error decl.
      if (this.isExceptionNext()) {
        return this.parseExceptionDecl(start, true)
      }
    }
    if (this.peek().kind === TokenKind.Let) {
      return this.parseLetDecl(start, exported)
    }
    if (this.isTypeAliasNext()) {
      return this.parseTypeAlias(start, exported)
    }
    if (this.isInterfaceNext()) {
      return this.parseInterfaceDecl(start, exported)
    }
    if (this.isExceptionNext()) {
      return this.parseExceptionDecl(start, exported)
    }
    // M8 Phase 4 — if an unexpected `instanceof` ident lands here, it
    // means a previous expression DIDN'T consume it (because Tu has no
    // binary `instanceof` operator). Surface a directive error so the
    // user sees a useful message instead of "expected 'let' or
    // 'import'…".
    const t = this.peek()
    if (t.kind === TokenKind.Ident && t.text === 'instanceof') {
      throw this.error(
        `'instanceof' is banned in Tu source. Use \`type.is(value, Interface)\` from @tu-lang/std for structural duck-typing checks. For genuine JS-nominal types (Promise, Map, Error, …) use \`type.is(value, type.Promise)\` etc. — the runtime descriptor wraps the \`instanceof\` check.`
      )
    }
    throw this.error(
      `expected 'let', 'export let', 'type', 'export type', 'interface', 'export interface', 'Exception', 'export Exception', 'import', or 'export {…} from …'`
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

  /**
   * `Exception` is contextual: only an introducer when followed by
   * `Ident {`. Distinct from `interface` by the capital `E` (intentional —
   * mirrors how Tu treats `Component` declarations vs. lowercase tags).
   * Reuses `parseInterfaceFields` since the field shape is identical.
   */
  private isExceptionNext(): boolean {
    const t1 = this.peek()
    if (t1.kind !== TokenKind.Ident || t1.text !== 'Exception') return false
    const t2 = this.tokens[this.pos + 1]
    if (t2?.kind !== TokenKind.Ident) return false
    const t3 = this.tokens[this.pos + 2]
    return t3?.kind === TokenKind.LBrace
  }

  private parseExceptionDecl(start: number, exported: boolean): ExceptionDecl {
    this.pos++ // consume the `Exception` ident
    const nameTok = this.expect(TokenKind.Ident)
    this.expect(TokenKind.LBrace)
    const fields = this.parseInterfaceFields()
    const closeBrace = this.expect(TokenKind.RBrace)
    return {
      kind: 'ExceptionDecl',
      exported,
      name: nameTok.text,
      nameStart: nameTok.start,
      nameEnd: nameTok.end,
      fields,
      start,
      end: closeBrace.end,
    }
  }

  /**
   * `interface` is contextual the same way: only an introducer when followed
   * by `Ident {`. Tu's M8 form for object-shape declarations — produces
   * BOTH a TS interface AND a runtime descriptor const at codegen.
   */
  private isInterfaceNext(): boolean {
    const t1 = this.peek()
    if (t1.kind !== TokenKind.Ident || t1.text !== 'interface') return false
    const t2 = this.tokens[this.pos + 1]
    if (t2?.kind !== TokenKind.Ident) return false
    const t3 = this.tokens[this.pos + 2]
    return t3?.kind === TokenKind.LBrace
  }

  /**
   * Parse `interface Name { f1: T1; f2?: T2 }`. Field separator is either
   * `;`, `,`, or a newline (handled by stripping whitespace at scan time).
   * The type expression for each field is captured as a raw text slice
   * between `:` and the field terminator — codegen translates it into
   * a `type.struct` field-list entry.
   */
  private parseInterfaceDecl(start: number, exported: boolean): InterfaceDecl {
    this.pos++ // consume the `interface` ident
    const nameTok = this.expect(TokenKind.Ident)
    this.expect(TokenKind.LBrace)
    const fields = this.parseInterfaceFields()
    const closeBrace = this.expect(TokenKind.RBrace)
    return {
      kind: 'InterfaceDecl',
      exported,
      name: nameTok.text,
      nameStart: nameTok.start,
      nameEnd: nameTok.end,
      fields,
      start,
      end: closeBrace.end,
    }
  }

  /**
   * Parse the body of an `interface` or `Exception` declaration —
   * `{ f1: T1; f2?: T2 }`. Field separator is `;`, `,`, or a newline
   * (the latter via `parseRawTypeUntilFieldBoundary`'s lookahead).
   * Caller is responsible for the surrounding `{` / `}`.
   */
  private parseInterfaceFields(): InterfaceField[] {
    const fields: InterfaceField[] = []
    while (this.peek().kind !== TokenKind.RBrace) {
      if (this.peek().kind === TokenKind.Eof) {
        throw this.error(`unterminated body — expected '}' before EOF`)
      }
      if (
        this.peek().kind === TokenKind.Semi ||
        this.peek().kind === TokenKind.Comma
      ) {
        this.pos++
        continue
      }
      const fieldName = this.expect(TokenKind.Ident)
      let optional = false
      if (this.peek().kind === TokenKind.Question) {
        this.pos++
        optional = true
      }
      this.expect(TokenKind.Colon)
      const typeSpan = this.parseRawTypeUntilFieldBoundary()
      fields.push({
        name: fieldName.text,
        rawType: typeSpan.text,
        optional,
        nameStart: fieldName.start,
        nameEnd: fieldName.end,
        typeStart: typeSpan.start,
        typeEnd: typeSpan.end,
      })
    }
    return fields
  }

  /**
   * Read a type-expression span inside an interface body. Tu fields don't
   * require `;` / `,` separators (newlines are eaten by the lexer's
   * `skipTrivia`), so we terminate when we see:
   *   - `}`           closes the interface body
   *   - `;` / `,`     explicit field separator (allowed for users coming
   *                   from TS who write them out)
   *   - `Ident :`     next field's name+colon at depth 0
   *   - `Ident ? :`   next field's name with optional marker
   *
   * `()` / `{}` / `[]` / `<…>` are depth-tracked so generic args + nested
   * object-type literals don't terminate early.
   */
  private parseRawTypeUntilFieldBoundary(): {
    text: string
    start: number
    end: number
  } {
    const start = this.peek().start
    let depth = 0
    let end = start
    while (true) {
      const t = this.peek()
      if (t.kind === TokenKind.Eof) break
      if (depth === 0) {
        if (
          t.kind === TokenKind.Semi ||
          t.kind === TokenKind.Comma ||
          t.kind === TokenKind.RBrace
        ) {
          break
        }
        // Lookahead: next field starts with `Ident :` (or `Ident ? :`).
        // Don't treat the FIRST token this way — we MUST consume at least
        // one token of the type expression.
        if (t.kind === TokenKind.Ident && this.pos > 0 && t.start > start) {
          const t2 = this.tokens[this.pos + 1]
          if (t2?.kind === TokenKind.Colon) break
          if (t2?.kind === TokenKind.Question) {
            const t3 = this.tokens[this.pos + 2]
            if (t3?.kind === TokenKind.Colon) break
          }
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
        if (depth === 0) break
        depth--
      }
      end = t.end
      this.pos++
    }
    return { text: this.source.slice(start, end), start, end }
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
        // M8: contextual `interface X { …` starts a new top-level decl
        // and terminates the current type-alias span.
        if (t.kind === TokenKind.Ident && t.text === 'interface') {
          const t2 = this.tokens[this.pos + 1]
          const t3 = this.tokens[this.pos + 2]
          if (t2?.kind === TokenKind.Ident && t3?.kind === TokenKind.LBrace) break
        }
        // M9+: contextual `Exception X { …` — same treatment.
        if (t.kind === TokenKind.Ident && t.text === 'Exception') {
          const t2 = this.tokens[this.pos + 1]
          const t3 = this.tokens[this.pos + 2]
          if (t2?.kind === TokenKind.Ident && t3?.kind === TokenKind.LBrace) break
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
    let defaultName: string | undefined
    let namespaceName: string | undefined
    const names: string[] = []
    // Three forms (and a couple combinations):
    //   import * as X from "M"
    //   import { a, b } from "M"
    //   import D from "M"
    //   import D, { a, b } from "M"
    //   import D, * as X from "M"
    if (this.peek().kind === TokenKind.Star) {
      this.pos++
      const asTok = this.expect(TokenKind.Ident)
      if (asTok.text !== 'as') throw this.error("expected 'as' after '*' in namespace import")
      namespaceName = this.expect(TokenKind.Ident).text
    } else if (this.peek().kind === TokenKind.Ident) {
      defaultName = this.expect(TokenKind.Ident).text
      if (this.peek().kind === TokenKind.Comma) {
        this.pos++
        if (this.peek().kind === TokenKind.Star) {
          this.pos++
          const asTok = this.expect(TokenKind.Ident)
          if (asTok.text !== 'as') throw this.error("expected 'as' after '*' in namespace import")
          namespaceName = this.expect(TokenKind.Ident).text
        } else if (this.peek().kind === TokenKind.LBrace) {
          this.pos++
          while (this.peek().kind !== TokenKind.RBrace) {
            names.push(this.expect(TokenKind.Ident).text)
            if (this.peek().kind === TokenKind.Comma) this.pos++
          }
          this.expect(TokenKind.RBrace)
        }
      }
    } else if (this.peek().kind === TokenKind.LBrace) {
      this.pos++
      while (this.peek().kind !== TokenKind.RBrace) {
        names.push(this.expect(TokenKind.Ident).text)
        if (this.peek().kind === TokenKind.Comma) this.pos++
      }
      this.expect(TokenKind.RBrace)
    } else {
      throw this.error("expected '{', '*', or an identifier after 'import'")
    }
    this.expect(TokenKind.From)
    const sourceTok = this.expect(TokenKind.String)
    const result: ImportDecl = {
      kind: 'ImportDecl',
      names,
      source: sourceTok.value as string,
      start,
      end: sourceTok.end,
    }
    if (defaultName !== undefined) result.default = defaultName
    if (namespaceName !== undefined) result.namespace = namespaceName
    return result
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

  /**
   * Captures the type-text slice for an `as Type` cast. Recognizes:
   *   - bare `Ident`
   *   - `Ident<...>` generic args (depth-tracked across nested `<>`)
   *   - trailing `[]` array suffix(es) — only when both brackets are
   *     adjacent (an `[expr]` with content stays as IndexExpr on the
   *     wrapped AsExpr in the next postfix iteration)
   * Unions / namespaced types / function types aren't parsed — wrap in a
   * named type alias if you need one.
   */
  private parseRawTypeForAsCast(): { text: string; start: number; end: number } {
    const startTok = this.expect(TokenKind.Ident)
    const start = startTok.start
    let end = startTok.end
    if (this.peek().kind === TokenKind.Lt) {
      let depth = 0
      while (true) {
        const t = this.peek()
        if (t.kind === TokenKind.Eof) {
          throw this.error(`unexpected EOF in cast type`)
        }
        if (t.kind === TokenKind.Lt) depth++
        else if (t.kind === TokenKind.Gt) {
          depth--
          end = t.end
          this.pos++
          if (depth === 0) break
          continue
        }
        end = t.end
        this.pos++
      }
    }
    while (
      this.peek().kind === TokenKind.LBracket &&
      this.tokens[this.pos + 1]?.kind === TokenKind.RBracket
    ) {
      this.pos++ // [
      const rb = this.peek()
      end = rb.end
      this.pos++ // ]
    }
    return { text: this.source.slice(start, end), start, end }
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
      // Compound assignment — desugar `x += y` → `x = x + y`. The
      // surrounding AssignExpr handling already maps to `cell.set(…)`
      // when the target is a state cell, so this just rebuilds the
      // RHS as a binary expression.
      const compound = next ? COMPOUND_ASSIGN_OPS[next.kind] : undefined
      if (compound !== undefined) {
        const targetTok = this.peek()
        this.pos += 2 // consume Ident and the compound op
        const rhs = this.parseExpr()
        const synth: BinaryExpr = {
          kind: 'BinaryExpr',
          op: compound,
          left: {
            kind: 'Ident',
            name: targetTok.text,
            start: targetTok.start,
            end: targetTok.end,
          },
          right: rhs,
          start: targetTok.start,
          end: rhs.end,
        }
        return {
          kind: 'AssignExpr',
          target: targetTok.text,
          value: synth,
          start: targetTok.start,
          end: rhs.end,
          targetStart: targetTok.start,
          targetEnd: targetTok.end,
        }
      }
    }
    // Try parsing a full expression first; if the result is a
    // MemberExpr / IndexExpr immediately followed by `=` or a compound
    // assign op, fold it into MemberAssignExpr. This handles
    // `btn.type = "..."`, `arr[i] = ...`, and the compound forms.
    const left = this.parseTernary()
    if (
      (left.kind === 'MemberExpr' || left.kind === 'IndexExpr') &&
      this.peek().kind === TokenKind.Equals
    ) {
      this.pos++ // consume `=`
      const value = this.parseExpr()
      return {
        kind: 'MemberAssignExpr',
        target: left,
        value,
        start: left.start,
        end: value.end,
      }
    }
    if (left.kind === 'MemberExpr' || left.kind === 'IndexExpr') {
      const compound = COMPOUND_ASSIGN_OPS[this.peek().kind]
      if (compound !== undefined) {
        this.pos++
        const rhs = this.parseExpr()
        const synth: BinaryExpr = {
          kind: 'BinaryExpr',
          op: compound,
          left,
          right: rhs,
          start: left.start,
          end: rhs.end,
        }
        return {
          kind: 'MemberAssignExpr',
          target: left,
          value: synth,
          start: left.start,
          end: rhs.end,
        }
      }
    }
    return left
  }

  /** Ternary `cond ? then : else` was added in M6.5 but is BANNED in
   *  M9 — Tu has expression-position `if cond { … } else { … }` which
   *  yields a value, so the ternary is redundant duplication of
   *  control-flow surface. The parser keeps the lookahead (so error
   *  messages still point at `?`) but throws a directive when the
   *  pattern matches. `external JS { … }` block bodies skip this
   *  check (their JS is opaque to Tu). */
  private parseTernary(): Expr {
    const cond = this.parseBinary(0)
    if (this.peek().kind !== TokenKind.Question) return cond
    throw this.error(
      `ternary '?:' is banned in Tu source. Use \`if cond { … } else { … }\` — it's an expression that yields a value (works wherever a ternary would). Inside \`external JS { … }\` block bodies the ternary is allowed (raw JS, opaque to Tu).`
    )
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
      // Postfix `++` / `--` — same accessibility gate as `!` so we don't
      // accidentally attach to a TagCall. Tu desugars these in codegen
      // to `x = x + 1` / `x = x - 1`; postfix returns the *old* value
      // via an IIFE wrap.
      // M9 ban: postfix `++` / `--` redirects to `+= 1` / `-= 1`.
      if (
        (this.peek().kind === TokenKind.PlusPlus || this.peek().kind === TokenKind.MinusMinus) &&
        isMemberAccessibleExpr(expr)
      ) {
        const op = this.peek().kind === TokenKind.PlusPlus ? '++' : '--'
        throw this.error(
          `postfix '${op}' is banned in Tu source. Use \`x ${op === '++' ? '+=' : '-='} 1\` — produces the same effect with no statement-vs-expression ambiguity.`
        )
      }
      // TS-style non-null assertion `expr!` — only attach to value-yielding
      // exprs (Ident, MemberExpr, etc.); the helper does the same gating
      // as the dot-chain branch below. Erased in JS-emit, preserved in
      // TS-emit so tsserver picks up the narrowing.
      if (this.peek().kind === TokenKind.Bang && isMemberAccessibleExpr(expr)) {
        const bang = this.peek()
        this.pos++ // consume `!`
        expr = {
          kind: 'NonNullAssertExpr',
          arg: expr,
          start: expr.start,
          end: bang.end,
        }
        continue
      }
      // TS-style cast `expr as Type` — contextual keyword `as` (Tu has no
      // dedicated token for it) followed by an ident type-name. Gate: the
      // next-next token must be an Ident, otherwise we leave `as` for
      // sibling parsing inside tag-call children. Tu doesn't parse types;
      // we capture a raw slice covering `Ident<...>?[]*` (no unions —
      // users wrap in a type alias if they need one).
      if (
        this.peek().kind === TokenKind.Ident &&
        this.peek().text === 'as' &&
        this.tokens[this.pos + 1]?.kind === TokenKind.Ident &&
        isMemberAccessibleExpr(expr)
      ) {
        this.pos++ // consume `as`
        const typeSpan = this.parseRawTypeForAsCast()
        expr = {
          kind: 'AsExpr',
          arg: expr,
          typeText: typeSpan.text,
          typeStart: typeSpan.start,
          typeEnd: typeSpan.end,
          start: expr.start,
          end: typeSpan.end,
        }
        continue
      }
      // `<expr>(args)` — call form on any callable expression that
      // isn't a bare identifier (those go through CallExpr in parse-
      // Primary, which gates HTML tags / scoping). Same accessibility
      // gate as dot-access below.
      if (this.peek().kind === TokenKind.LParen && isMemberAccessibleExpr(expr) && expr.kind !== 'Ident') {
        this.pos++ // consume `(`
        const args: Expr[] = []
        while (this.peek().kind !== TokenKind.RParen) {
          args.push(this.parseSpreadOrExpr())
          if (this.peek().kind === TokenKind.Comma) this.pos++
        }
        const rparen = this.expect(TokenKind.RParen)
        expr = {
          kind: 'InvokeExpr',
          callee: expr,
          args,
          start: expr.start,
          end: rparen.end,
        }
        continue
      }
      // Computed-key access — `obj[expr]`. Only valid after a value-
      // yielding expr; otherwise an `[…]` after some other construct
      // (e.g. `for x in xs { … }`) would greedily eat a sibling array
      // literal in tag-call children. Same gate as dot-access below.
      if (this.peek().kind === TokenKind.LBracket && isMemberAccessibleExpr(expr)) {
        this.pos++ // consume `[`
        const index = this.parseExpr()
        const rbracket = this.expect(TokenKind.RBracket)
        expr = {
          kind: 'IndexExpr',
          object: expr,
          index,
          start: expr.start,
          end: rbracket.end,
        }
        continue
      }
      const head = this.peek().kind
      const isOptional = head === TokenKind.QuestionDot
      if (head !== TokenKind.Dot && !isOptional) return expr
      if (!isMemberAccessibleExpr(expr)) return expr
      const next = this.tokens[this.pos + 1]
      // After `?.` we accept three follow-ups: an Ident (member /
      // method), `(` (optional call: `fn?.()`), or `[` (optional
      // computed: `arr?.[i]`). After plain `.` only Ident is valid.
      if (isOptional) {
        if (next?.kind === TokenKind.LParen) {
          this.pos += 2 // consume `?.` and `(`
          const args: Expr[] = []
          while (this.peek().kind !== TokenKind.RParen) {
            args.push(this.parseSpreadOrExpr())
            if (this.peek().kind === TokenKind.Comma) this.pos++
          }
          const rparen = this.expect(TokenKind.RParen)
          // No member name — represent as MethodCallExpr with `property
          // === ''` is awkward; instead emit a plain CallExpr-like
          // shape via MethodCallExpr-on-an-empty-string would mislead
          // codegen's `.method()` write. Use IndexExpr-like trick: emit
          // a MethodCallExpr whose property is `''` and special-case in
          // codegen — but that's brittle. Cleanest path: introduce a
          // dedicated optional-call node. To keep this PR small, model
          // optional call as a CallExpr-like via the existing
          // MethodCallExpr where empty property + optional flag means
          // direct call. Codegen emits `<obj>?.( … )`.
          expr = {
            kind: 'MethodCallExpr',
            object: expr,
            property: '',
            args,
            start: expr.start,
            end: rparen.end,
            propertyStart: rparen.start,
            propertyEnd: rparen.start,
            optional: true,
          }
          continue
        }
        if (next?.kind === TokenKind.LBracket) {
          this.pos += 2 // consume `?.` and `[`
          const index = this.parseExpr()
          const rbracket = this.expect(TokenKind.RBracket)
          expr = {
            kind: 'IndexExpr',
            object: expr,
            index,
            start: expr.start,
            end: rbracket.end,
            optional: true,
          }
          continue
        }
      }
      if (next?.kind !== TokenKind.Ident) return expr
      this.pos++ // consume the `.` or `?.`
      const propTok = this.expect(TokenKind.Ident)
      // M5.9: `.Ident` immediately followed by `(args)` is a method
      // call (`obj.method(arg1, arg2)`). Collapse into MethodCallExpr.
      // Anything else stays plain MemberExpr (the loop continues for
      // chained access like `a.b.c`).
      if (this.peek().kind === TokenKind.LParen) {
        this.pos++ // consume the `(`
        const args: Expr[] = []
        while (this.peek().kind !== TokenKind.RParen) {
          args.push(this.parseSpreadOrExpr())
          if (this.peek().kind === TokenKind.Comma) this.pos++
        }
        const rparen = this.expect(TokenKind.RParen)
        const callNode: MethodCallExpr = {
          kind: 'MethodCallExpr',
          object: expr,
          property: propTok.text,
          args,
          start: expr.start,
          end: rparen.end,
          propertyStart: propTok.start,
          propertyEnd: propTok.end,
        }
        if (isOptional) callNode.optional = true
        expr = callNode
        continue
      }
      const memberNode: MemberExpr = {
        kind: 'MemberExpr',
        object: expr,
        property: propTok.text,
        start: expr.start,
        end: propTok.end,
        propertyStart: propTok.start,
        propertyEnd: propTok.end,
      }
      if (isOptional) memberNode.optional = true
      expr = memberNode
    }
  }

  private parsePrefix(): Expr {
    const k = this.peek().kind
    if (k === TokenKind.LParen) {
      return this.peekArrowFollowsParen() ? this.parseLambda() : this.parseParenExpr()
    }
    if (k === TokenKind.LBrace && !this.noBraceBlock) {
      return this.peekObjectLitShape() ? this.parseObjectLit() : this.parseBlock()
    }
    if (k === TokenKind.LBracket) return this.parseArrayLit()
    if (k === TokenKind.If) {
      // `if let a = expr { … }` — bind-and-test sugar (M9 / Rust-style).
      // Strict non-null guard (`a !== null && a !== undefined`); the
      // binding is scoped to the `then` branch by virtue of the wrapping
      // Block so TS narrows `a` to `NonNullable<T>` inside.
      if (this.tokens[this.pos + 1]?.kind === TokenKind.Let) {
        return this.parseIfLetSugar()
      }
      return this.parseIfExpr()
    }
    if (k === TokenKind.For) return this.parseForExpr()
    if (k === TokenKind.Try) return this.parseTryExpr()
    if (k === TokenKind.Throw) return this.parseThrowExpr()
    if (k === TokenKind.Return) return this.parseReturnExpr()
    if (k === TokenKind.Dot) return this.parseClassRefOrPugShorthand()
    if (k === TokenKind.New) {
      const tok = this.peek()
      this.pos++ // consume `new`
      const arg = this.parsePostfix(this.parsePrefix())
      // M9 ban: `new Array(n)` — single-numeric-arg ctor produces a
      // sparse-length array, the JS-Array footgun source. Use `[…]`
      // literal for explicit elements (sparse slots become `null` per
      // the M9 sparse-array normalization). Multi-arg `new Array(1, 2,
      // 3)` is also banned for consistency — it's a confusing alias
      // for `[1, 2, 3]`. Other constructors (`new Promise`, `new Map`,
      // `new Error`, …) pass through.
      if (
        arg.kind === 'CallExpr' &&
        typeof arg.callee === 'string' &&
        arg.callee === 'Array'
      ) {
        throw this.error(
          `'new Array(…)' is banned in Tu source. Use array literal \`[…]\` instead — explicit elements are clearer than ctor-arg semantics, and Tu normalizes sparse slots to \`null\`.`
        )
      }
      if (
        arg.kind === 'CallExpr' &&
        typeof arg.callee === 'string' &&
        arg.callee === 'Date'
      ) {
        throw this.error(
          `'new Date(…)' is banned in Tu source. Use \`@tu-lang/std/time\` Temporal helpers instead — Date's mutable, timezone-implicit API is intentionally kept out of Tu.`
        )
      }
      return { kind: 'NewExpr', arg, start: tok.start, end: arg.end }
    }
    if (k === TokenKind.Async) {
      const tok = this.peek()
      this.pos++ // consume `async`
      // `async external JS (…) { … }` — apply async to the external lambda.
      if (this.peek().kind === TokenKind.External) {
        const ext = this.parseExternalLambda()
        ext.async = true
        ext.start = tok.start
        return ext
      }
      const lambda = this.parseLambda()
      lambda.async = true
      lambda.start = tok.start
      return lambda
    }
    if (k === TokenKind.External) {
      return this.parseExternalLambda()
    }
    if (k === TokenKind.Await) {
      const tok = this.peek()
      this.pos++
      const arg = this.parsePostfix(this.parsePrefix())
      return { kind: 'AwaitExpr', arg, start: tok.start, end: arg.end }
    }
    if (k === TokenKind.Import) {
      // Dynamic import — `import('mod')`. Static `import { … } from "…"`
      // statements are handled at the program-body level by parseStmt
      // before we ever get here.
      const tok = this.peek()
      this.pos++ // consume `import`
      this.expect(TokenKind.LParen)
      const arg = this.parseExpr()
      const rparen = this.expect(TokenKind.RParen)
      return { kind: 'ImportExpr', arg, start: tok.start, end: rparen.end }
    }
    if (k === TokenKind.PlusPlus || k === TokenKind.MinusMinus) {
      const op = k === TokenKind.PlusPlus ? '++' : '--'
      throw this.error(
        `prefix '${op}' is banned in Tu source. Use \`x ${op === '++' ? '+=' : '-='} 1\` — produces the same effect with no statement-vs-expression ambiguity.`
      )
    }
    if (k === TokenKind.Backtick) return this.parseTemplateLit()
    if (k === TokenKind.Bang || k === TokenKind.Minus || k === TokenKind.Plus) {
      const tok = this.peek()
      const op = k === TokenKind.Bang ? '!' : k === TokenKind.Minus ? '-' : '+'
      this.pos++ // consume the prefix operator
      const arg = this.parsePostfix(this.parsePrefix())
      return {
        kind: 'UnaryExpr',
        op,
        arg,
        start: tok.start,
        end: arg.end,
      }
    }
    return this.parsePrimary()
  }

  /** `` `text ${expr} more text ${expr2} tail` `` — alternates literal
   *  chunks and embedded expressions. The lexer already normalized
   *  escape sequences, so quasis arrive as decoded JS strings. */
  private parseTemplateLit(): TemplateLit {
    const start = this.expect(TokenKind.Backtick).start
    const quasis: string[] = []
    const expressions: Expr[] = []
    let lastChunkText = ''
    while (true) {
      const t = this.peek()
      if (t.kind === TokenKind.TemplateChunk) {
        lastChunkText = (t.value as string | undefined) ?? t.text
        this.pos++
      } else if (t.kind === TokenKind.DollarLBrace) {
        this.pos++
        quasis.push(lastChunkText)
        lastChunkText = ''
        expressions.push(this.parseExpr())
        this.expect(TokenKind.TemplateExprClose)
      } else if (t.kind === TokenKind.Backtick) {
        const end = t.end
        this.pos++
        quasis.push(lastChunkText)
        return { kind: 'TemplateLit', quasis, expressions, start, end }
      } else {
        throw this.error('unterminated template literal')
      }
    }
  }

  /**
   * `throw expr` — parsed as an expression so it can sit in any value
   * position (if branches, &&, etc.). Codegen emits a clean `throw …;`
   * statement when the surrounding context is a Block; otherwise it
   * wraps the whole thing in an IIFE for side-effect correctness.
   */
  private parseThrowExpr(): Expr {
    const start = this.expect(TokenKind.Throw).start
    const arg = this.parseExpr()
    return { kind: 'ThrowExpr', arg, start, end: arg.end }
  }

  /**
   * `return [expr]` — early return from a lambda body. Same Block-vs-
   * IIFE codegen treatment as throw. The trailing expression is
   * optional; bare `return` returns undefined.
   */
  private parseReturnExpr(): Expr {
    const tok = this.expect(TokenKind.Return)
    // Detect bare `return` by peeking for tokens that clearly cannot
    // start a value expression. Anything else is treated as the
    // returned value — keeps the syntax forgiving.
    const next = this.peek().kind
    const bareEnders = new Set<TokenKind>([
      TokenKind.RBrace, TokenKind.RParen, TokenKind.RBracket,
      TokenKind.Comma, TokenKind.Semi, TokenKind.Eof,
      TokenKind.Let, TokenKind.Export, TokenKind.Import, TokenKind.From,
      TokenKind.If, TokenKind.Else, TokenKind.For, TokenKind.In,
      TokenKind.Try, TokenKind.Catch, TokenKind.Finally,
      TokenKind.Throw, TokenKind.Return,
    ])
    if (bareEnders.has(next)) {
      return { kind: 'ReturnExpr', start: tok.start, end: tok.end }
    }
    const value = this.parseExpr()
    return { kind: 'ReturnExpr', value, start: tok.start, end: value.end }
  }

  /**
   * `try { … } catch (e[: T]) { … } finally { … }` — both catch and
   * finally are optional but at least one must be present (matches JS
   * grammar; lets the diagnostic catch a `try { … }` with no handler).
   */
  private parseTryExpr(): TryExpr {
    const start = this.expect(TokenKind.Try).start
    const body = this.parseBlock()
    let catchClause: TryCatchClause | undefined
    let finallyClause: Block | undefined
    let endOffset = body.end
    if (this.peek().kind === TokenKind.Catch) {
      this.pos++
      let param = ''
      let paramStart = this.peek().start
      let paramEnd = paramStart
      let type: string | undefined
      if (this.peek().kind === TokenKind.LParen) {
        this.pos++
        if (this.peek().kind === TokenKind.RParen) {
          // `catch ()` — semantically same as bare `catch { … }`; just
          // accept it as if no binding.
          this.pos++
        } else {
          const nameTok = this.expect(TokenKind.Ident)
          param = nameTok.text
          paramStart = nameTok.start
          paramEnd = nameTok.end
          if (this.peek().kind === TokenKind.Colon) {
            this.pos++
            const span = this.parseRawTypeUntilParamBoundary()
            type = span.text
          }
          this.expect(TokenKind.RParen)
        }
      }
      const catchBody = this.parseBlock()
      catchClause = { param, paramStart, paramEnd, body: catchBody }
      if (type !== undefined) catchClause.type = type
      endOffset = catchBody.end
    }
    if (this.peek().kind === TokenKind.Finally) {
      this.pos++
      finallyClause = this.parseBlock()
      endOffset = finallyClause.end
    }
    if (!catchClause && !finallyClause) {
      throw this.error('try expression requires a `catch` or `finally` clause')
    }
    const result: TryExpr = { kind: 'TryExpr', body, start, end: endOffset }
    if (catchClause) result.catchClause = catchClause
    if (finallyClause) result.finallyClause = finallyClause
    return result
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
    // `{ ...source, … }` is unambiguously an object literal — Block
    // bodies don't accept a leading spread expression.
    if (t1.kind === TokenKind.DotDotDot) return true
    const t2 = this.tokens[this.pos + 2]
    if (!t2) return false
    // Shorthand `{ id, … }` — Ident immediately followed by `,` is an
    // unambiguous object-literal signal (Block bodies use newlines
    // between statements, not commas). Single-item `{ id }` (Ident
    // then `}`) stays a Block to preserve last-expression-returns
    // semantics, since either reading is valid there.
    if (t1.kind === TokenKind.Ident && t2.kind === TokenKind.Comma) return true
    if (t2.kind !== TokenKind.Colon) return false
    return t1.kind === TokenKind.Ident || t1.kind === TokenKind.String
  }

  private parseObjectLit(): ObjectLit {
    const lbrace = this.expect(TokenKind.LBrace)
    const properties: ObjectMember[] = []
    while (this.peek().kind !== TokenKind.RBrace) {
      if (this.peek().kind === TokenKind.DotDotDot) {
        const tok = this.peek()
        this.pos++
        const arg = this.parseExpr()
        properties.push({ kind: 'ObjectSpread', arg, start: tok.start, end: arg.end })
      } else {
        properties.push(this.parseObjectProp())
      }
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
    // Shorthand: `{ id, … }` and `{ id }` (when reached via the new
    // ident-comma rule in peekObjectLitShape, or via a sibling
    // shorthand prop). The key doubles as the value: `{ id }` is
    // equivalent to `{ id: id }`. Ident keys only — string keys
    // can't reference a binding by the same name.
    const after = this.peek()
    if (
      keyKind === 'ident' &&
      (after.kind === TokenKind.Comma || after.kind === TokenKind.RBrace)
    ) {
      const value: Expr = {
        kind: 'Ident',
        name: key,
        start: keyTok.start,
        end: keyTok.end,
      }
      return {
        key,
        keyKind,
        value,
        keyStart: keyTok.start,
        keyEnd: keyTok.end,
      }
    }
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
    // M9 ban: sparse-array slots `[a, , c]` are normalized to explicit
    // `null` instead of leaving holes (the JS-Array footgun). When the
    // loop sees a leading `,` (no value yet pushed since the last
    // comma boundary), synthesize a NullLit-shaped Ident('null') in
    // its place. Trailing comma `[a,]` is fine — exits the loop on
    // `]` without re-entering the empty-slot branch.
    while (this.peek().kind !== TokenKind.RBracket) {
      if (this.peek().kind === TokenKind.Comma) {
        const tok = this.peek()
        elements.push({ kind: 'Ident', name: 'null', start: tok.start, end: tok.start } as Expr)
        this.pos++
        continue
      }
      elements.push(this.parseSpreadOrExpr())
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

  /** Parse either `...expr` (a SpreadElement) or a plain expression.
   *  Used at call-arg / array-element / object-property positions. */
  private parseSpreadOrExpr(): Expr {
    if (this.peek().kind === TokenKind.DotDotDot) {
      const tok = this.peek()
      this.pos++ // consume `...`
      const arg = this.parseExpr()
      return { kind: 'SpreadElement', arg, start: tok.start, end: arg.end }
    }
    return this.parseExpr()
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

  /**
   * Disambiguate `(…)` between a Lambda and a parenthesized expression.
   * Scans forward across balanced parens / brackets / braces to find the
   * matching `)`, then peeks past the optional `: returnType` span. If
   * the next token is `=>`, this is a lambda; otherwise it's a
   * parenthesized expression. Lambdas with explicit return-type
   * annotations still parse correctly because the return-type span
   * never contains a `=>` (the lexer treats `=>` as a single token, and
   * type spans use Pipe/Amp/Question for unions/optionals).
   */
  private peekArrowFollowsParen(): boolean {
    let depth = 0
    let i = this.pos
    for (; i < this.tokens.length; i++) {
      const t = this.tokens[i]!
      if (
        t.kind === TokenKind.LParen ||
        t.kind === TokenKind.LBrace ||
        t.kind === TokenKind.LBracket
      ) {
        depth++
      } else if (
        t.kind === TokenKind.RParen ||
        t.kind === TokenKind.RBrace ||
        t.kind === TokenKind.RBracket
      ) {
        depth--
        if (depth === 0 && t.kind === TokenKind.RParen) {
          // Walk past an optional `: returnType` span to find the `=>`.
          let j = i + 1
          if (this.tokens[j]?.kind === TokenKind.Colon) {
            j++
            // Skip a balanced type-span until we hit `=>` or a stmt boundary.
            while (j < this.tokens.length) {
              const tj = this.tokens[j]!
              if (tj.kind === TokenKind.FatArrow && depth === 0) return true
              if (
                tj.kind === TokenKind.LBrace ||
                tj.kind === TokenKind.LParen ||
                tj.kind === TokenKind.LBracket
              ) {
                depth++
              } else if (
                tj.kind === TokenKind.RBrace ||
                tj.kind === TokenKind.RParen ||
                tj.kind === TokenKind.RBracket
              ) {
                if (depth === 0) return false
                depth--
              } else if (tj.kind === TokenKind.Eof) {
                return false
              }
              j++
            }
            return false
          }
          return this.tokens[j]?.kind === TokenKind.FatArrow
        }
      } else if (t.kind === TokenKind.Eof) {
        return false
      }
    }
    return false
  }

  /**
   * Parenthesized expression — `(expr)`. Only reached when
   * `peekArrowFollowsParen` returned false, so we know there's no `=>`
   * after the close paren. The wrapping parens are erased; precedence is
   * preserved by the recursive `parseExpr` already inside the parens.
   */
  private parseParenExpr(): Expr {
    this.expect(TokenKind.LParen)
    const inner = this.parseExpr()
    this.expect(TokenKind.RParen)
    return inner
  }

  /** `external <Lang> (params) [: returnType] { raw body }` — read the
   *  lambda head normally, then collect the body as a raw source slice
   *  by walking forward through tokens with a brace counter until we
   *  find the matching `}`. The body text comes from `this.source` so
   *  comments / whitespace round-trip exactly into the emitted JS. */
  private parseExternalLambda(): ExternalLambda {
    const externalTok = this.expect(TokenKind.External)
    const langTok = this.expect(TokenKind.Ident)
    const lang = langTok.text
    let params: Param[] = []
    if (this.peek().kind === TokenKind.LParen) {
      this.pos++
      while (this.peek().kind !== TokenKind.RParen) {
        params.push(this.parseParam())
        if (this.peek().kind === TokenKind.Comma) this.pos++
      }
      this.expect(TokenKind.RParen)
    }
    let returnType: string | undefined
    let returnTypeStart: number | undefined
    let returnTypeEnd: number | undefined
    if (this.peek().kind === TokenKind.Colon) {
      this.pos++
      const span = this.parseRawTypeUntilBrace()
      returnType = span.text
      returnTypeStart = span.start
      returnTypeEnd = span.end
    }
    const lbrace = this.expect(TokenKind.LBrace)
    // Walk forward through the lexed token stream balancing braces;
    // the body's source slice runs from after-the-`{` to before-the-`}`.
    let depth = 1
    let endTok = this.peek()
    while (this.pos < this.tokens.length) {
      const t = this.peek()
      if (t.kind === TokenKind.Eof) {
        throw this.error('unterminated external block')
      }
      if (t.kind === TokenKind.LBrace) depth++
      else if (t.kind === TokenKind.RBrace) {
        depth--
        if (depth === 0) {
          endTok = t
          this.pos++
          break
        }
      }
      this.pos++
    }
    const body = this.source.slice(lbrace.end, endTok.start)
    const result: ExternalLambda = {
      kind: 'ExternalLambda',
      lang,
      params,
      body,
      bodyStart: lbrace.end,
      bodyEnd: endTok.start,
      start: externalTok.start,
      end: endTok.end,
    }
    if (returnType !== undefined) {
      result.returnType = returnType
      result.returnTypeStart = returnTypeStart!
      result.returnTypeEnd = returnTypeEnd!
    }
    return result
  }

  /** Like parseRawTypeUntilFatArrow but stops at `{` (the body opener)
   *  instead of `=>`. Used by parseExternalLambda to read the optional
   *  return-type span between `: T` and the body brace.
   *
   *  Tricky case: object-shape return types like
   *    `external JS (xs: T): { ms: number; out: any[] } { … }`
   *  The `{` at depth 0 here could be a type literal (e.g. start of
   *  `{ ms: number }`) OR the body opener. Disambiguate by looking at
   *  the IMMEDIATELY PRECEDING token: if it's a "type-continuation"
   *  token (`:` after the colon, `&`/`|` operator, `=>` from a
   *  function type, `,` inside a tuple, `[`, `(`, `<`, `?`), the `{`
   *  starts a type literal — consume the balanced `{…}` and keep
   *  scanning. Otherwise the `{` is the body opener — stop. */
  private parseRawTypeUntilBrace(): { text: string; start: number; end: number } {
    const start = this.peek().start
    const startPos = this.pos
    let depth = 0
    while (this.pos < this.tokens.length) {
      const t = this.peek()
      if (t.kind === TokenKind.Eof) break
      if (depth === 0 && t.kind === TokenKind.LBrace) {
        // Decide: type literal or body opener.
        const prev = this.pos > startPos ? this.tokens[this.pos - 1] : undefined
        const isTypeLiteral = prev === undefined || isTypeContinuationToken(prev.kind)
        if (!isTypeLiteral) break
        const close = this.findBalancedBraceClose(this.pos)
        if (close < 0) break // unbalanced — bail to caller
        // Consume the whole balanced `{…}` as part of the type span.
        this.pos = close + 1
        continue
      }
      if (
        t.kind === TokenKind.LParen ||
        t.kind === TokenKind.LBrace ||
        t.kind === TokenKind.LBracket ||
        t.kind === TokenKind.Lt
      ) depth++
      else if (
        t.kind === TokenKind.RParen ||
        t.kind === TokenKind.RBrace ||
        t.kind === TokenKind.RBracket ||
        t.kind === TokenKind.Gt
      ) depth--
      this.pos++
    }
    const end = this.tokens[this.pos - 1]?.end ?? start
    return { text: this.source.slice(start, end).trim(), start, end }
  }

  /** Walk forward from `startPos` (must point at a `{`) and return the
   *  index of its matching `}`. Returns -1 if unbalanced before EOF. */
  private findBalancedBraceClose(startPos: number): number {
    let depth = 0
    for (let i = startPos; i < this.tokens.length; i++) {
      const k = this.tokens[i]!.kind
      if (k === TokenKind.LBrace) depth++
      else if (k === TokenKind.RBrace) {
        depth--
        if (depth === 0) return i
      } else if (k === TokenKind.Eof) return -1
    }
    return -1
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
    let throwsType: string | undefined
    let throwsTypeStart: number | undefined
    let throwsTypeEnd: number | undefined
    if (this.peek().kind === TokenKind.Colon) {
      this.pos++
      const span = this.parseRawTypeUntilFatArrow()
      // Split the captured raw text on a top-level `?` — Tu's M9
      // exception system: `(…): R ? AError|BError => …` annotates a
      // function's throws clause. The first depth-0 `?` separates
      // return type from throws-type expression.
      const split = splitOnTopLevelQuestion(span.text)
      if (split !== null) {
        returnType = split.before
        // We don't have separate byte offsets for the split — Tu source
        // bytes are continuous, so derive from the local offset.
        returnTypeStart = span.start
        returnTypeEnd = span.start + split.questionOffset
        throwsType = split.after
        throwsTypeStart = span.start + split.questionOffset + 1
        throwsTypeEnd = span.end
      } else {
        returnType = span.text
        returnTypeStart = span.start
        returnTypeEnd = span.end
      }
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
    if (throwsType !== undefined) {
      lambda.throwsType = throwsType
      lambda.throwsTypeStart = throwsTypeStart!
      lambda.throwsTypeEnd = throwsTypeEnd!
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
    // M9 — object-destructure pattern `({ a, b, c }: T)`. We synthesize
    // a placeholder name; codegen branches on `destructureFields` to
    // emit `{ a, b, c }` in the param position instead. Type annotation
    // is REQUIRED — an untyped destructure would land on TS's M9-default
    // `unknown` and error on every key access.
    if (this.peek().kind === TokenKind.LBrace) {
      const lbrace = this.expect(TokenKind.LBrace)
      const fields: string[] = []
      while (this.peek().kind !== TokenKind.RBrace) {
        const fieldTok = this.expect(TokenKind.Ident)
        fields.push(fieldTok.text)
        if (this.peek().kind === TokenKind.Comma) this.pos++
      }
      const rbrace = this.expect(TokenKind.RBrace)
      if (this.peek().kind !== TokenKind.Colon) {
        throw this.error(
          `destructured params require a type annotation — write \`{ ${fields.join(', ')} }: SomeType\`. Without one, TS narrows the param to \`unknown\` (M9 default) and rejects every field access.`
        )
      }
      this.pos++ // consume `:`
      const span = this.parseRawTypeUntilParamBoundary()
      return {
        name: `__tu_destruct_${lbrace.start}`,
        destructureFields: fields,
        type: span.text,
        start: lbrace.start,
        end: span.end,
        nameStart: lbrace.start,
        nameEnd: rbrace.end,
      } satisfies Param
    }
    const nameTok = this.expect(TokenKind.Ident)
    let type: string | undefined
    let endOffset = nameTok.end
    // TS-style optional param: `(name?: T)`. Tu mirrors the syntax — the
    // `?` is folded into the emitted TS type span so tsserver sees a
    // proper optional. We append ` | undefined` rather than rewriting
    // the param name to `name?` since codegen emits the param name in
    // a JS context where `?` would be a syntax error.
    let optional = false
    if (this.peek().kind === TokenKind.Question) {
      optional = true
      this.pos++
      endOffset = this.tokens[this.pos - 1]!.end
    }
    if (this.peek().kind === TokenKind.Colon) {
      this.pos++
      const span = this.parseRawTypeUntilParamBoundary()
      type = optional ? `(${span.text}) | undefined` : span.text
      endOffset = span.end
    } else if (optional) {
      // `name?` with no colon = implicit `unknown | undefined`. Pass the
      // narrower `undefined` through; tsserver will widen as needed.
      type = 'undefined'
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
    // M9 — destructure pattern `let { a, b } = expr`. RHS provides the
    // type info via TS inference, so the type annotation slot stays
    // optional here (unlike param destructuring where the M9-default
    // `unknown` would otherwise land on the param).
    if (this.peek().kind === TokenKind.LBrace) {
      const lbrace = this.expect(TokenKind.LBrace)
      const fields: string[] = []
      while (this.peek().kind !== TokenKind.RBrace) {
        const fieldTok = this.expect(TokenKind.Ident)
        fields.push(fieldTok.text)
        if (this.peek().kind === TokenKind.Comma) this.pos++
      }
      const rbrace = this.expect(TokenKind.RBrace)
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
        name: `__tu_destruct_${lbrace.start}`,
        destructureFields: fields,
        value,
        start: letTok.start,
        end: value.end,
        nameStart: lbrace.start,
        nameEnd: rbrace.end,
      }
      if (type !== undefined) {
        out.type = type
        out.typeStart = typeStart!
        out.typeEnd = typeEnd!
      }
      return out
    }
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

  /**
   * `if let a = expr { body } [else { … }]` — bind-and-test sugar.
   * Desugars at parse-time to an IIFE wrapping a Block so we don't need
   * a new AST shape (or walker / codegen fanout) AND so we can place
   * the result anywhere a value-expr is allowed (tag-call children
   * disallow bare Block):
   *
   *   (() => {
   *     let a = expr
   *     if ((a !== null) && (a !== undefined)) { body } [else { … }]
   *   })()
   *
   * The double-strict cond is the only way to get nullish narrowing
   * under Tu's `==` → `===` rewrite, and it's exactly the predicate
   * tsserver recognizes for `NonNullable<T>` narrowing inside the
   * `then` branch. RHS is parsed under `noBraceBlock` so the `{` of
   * the body block doesn't get eaten as a tag-call children block —
   * mirrors the same trick `parseForExpr` uses for its iter slot.
   */
  private parseIfLetSugar(): Expr {
    const ifTok = this.expect(TokenKind.If)
    this.expect(TokenKind.Let)
    const nameTok = this.expect(TokenKind.Ident)
    let typeText: string | undefined
    let typeStart: number | undefined
    let typeEnd: number | undefined
    if (this.peek().kind === TokenKind.Colon) {
      this.pos++
      const span = this.parseRawTypeUntilEquals()
      typeText = span.text
      typeStart = span.start
      typeEnd = span.end
    }
    this.expect(TokenKind.Equals)
    const prev = this.noBraceBlock
    this.noBraceBlock = true
    let rhs: Expr
    try {
      rhs = this.parseExpr()
    } finally {
      this.noBraceBlock = prev
    }
    const thenBlock = this.parseBlock()
    let elseBranch: Block | IfExpr | undefined
    if (this.peek().kind === TokenKind.Else) {
      this.pos++
      if (this.peek().kind === TokenKind.If) {
        elseBranch = this.parseIfExpr()
      } else {
        elseBranch = this.parseBlock()
      }
    }
    const localLet: LocalLet = {
      kind: 'LocalLet',
      name: nameTok.text,
      value: rhs,
      start: nameTok.start,
      end: rhs.end,
      nameStart: nameTok.start,
      nameEnd: nameTok.end,
    }
    if (typeText !== undefined) {
      localLet.type = typeText
      localLet.typeStart = typeStart!
      localLet.typeEnd = typeEnd!
    }
    const aIdent = (): Ident => ({
      kind: 'Ident',
      name: nameTok.text,
      start: nameTok.start,
      end: nameTok.end,
    })
    const nullIdent = (): Ident => ({
      kind: 'Ident',
      name: 'null',
      start: nameTok.start,
      end: nameTok.end,
    })
    const undefinedIdent = (): Ident => ({
      kind: 'Ident',
      name: 'undefined',
      start: nameTok.start,
      end: nameTok.end,
    })
    const cond: BinaryExpr = {
      kind: 'BinaryExpr',
      op: '&&',
      left: {
        kind: 'BinaryExpr',
        op: '!=',
        left: aIdent(),
        right: nullIdent(),
        start: nameTok.start,
        end: nameTok.end,
      },
      right: {
        kind: 'BinaryExpr',
        op: '!=',
        left: aIdent(),
        right: undefinedIdent(),
        start: nameTok.start,
        end: nameTok.end,
      },
      start: nameTok.start,
      end: nameTok.end,
    }
    const ifExpr: IfExpr =
      elseBranch === undefined
        ? {
            kind: 'IfExpr',
            cond,
            then: thenBlock,
            start: ifTok.start,
            end: thenBlock.end,
          }
        : {
            kind: 'IfExpr',
            cond,
            then: thenBlock,
            else: elseBranch,
            start: ifTok.start,
            end: elseBranch.end,
          }
    const block: Block = {
      kind: 'Block',
      body: [localLet, ifExpr],
      start: ifTok.start,
      end: ifExpr.end,
    }
    const lambda: Lambda = {
      kind: 'Lambda',
      params: [],
      body: block,
      start: ifTok.start,
      end: block.end,
    }
    return {
      kind: 'InvokeExpr',
      callee: lambda,
      args: [],
      start: ifTok.start,
      end: block.end,
    }
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
      // M8 Phase 4 — `typeof` and `instanceof` are permanently banned in
      // Tu source. They surface here as plain Ident tokens; throw with
      // directive errors pointing at the M8 replacement API. Inside an
      // `external JS { … }` body the lexer doesn't tokenize the body,
      // so this rule never triggers there — escape hatch preserved.
      if (t.text === 'typeof') {
        throw this.error(
          `'typeof' is banned in Tu source. Use \`type.of(value)\` from @tu-lang/std instead — it returns a runtime descriptor that distinguishes null, arrays, and structs (vs JS \`typeof\` which lumps them all under 'object').`
        )
      }
      if (t.text === 'instanceof') {
        throw this.error(
          `'instanceof' is banned in Tu source. Use \`type.is(value, Interface)\` from @tu-lang/std for structural duck-typing checks. For genuine JS-nominal types (Promise, Map, Error, …) use \`type.is(value, type.Promise)\` etc. — the runtime descriptor wraps the \`instanceof\` check.`
        )
      }
      if (t.text === 'void') {
        throw this.error(
          `'void' operator is banned in Tu source. Use \`null\` for intentional empty values; type-position \`: void\` return annotations are still allowed.`
        )
      }
      if (t.text === 'this') {
        throw this.error(
          `'this' is banned in Tu source. Components and helpers are lexical lambdas; pass dependencies explicitly instead of relying on method receiver binding.`
        )
      }
      if (t.text === 'arguments') {
        throw this.error(
          `'arguments' is banned in Tu source. Use an explicit rest parameter (\`...args\`) so the call shape is visible to the type checker.`
        )
      }
      if (t.text === 'class') {
        throw this.error(
          `'class' is banned in Tu source. Use \`interface\` for object shapes and \`let Name = (...) => ...\` for components/helpers.`
        )
      }
      if (t.text === 'var') {
        throw this.error(
          `'var' is banned in Tu source. Use \`let\`; top-level lets become reactive cells and local lets are block-scoped.`
        )
      }
      if (t.text === 'with') {
        throw this.error(
          `'with' is banned in Tu source. Destructure or pass explicit objects instead; implicit scope mutation is not part of Tu.`
        )
      }
      this.pos++
      return this.parseIdentTail(t)
    }
    if (t.kind === TokenKind.Regex) {
      this.pos++
      return { kind: 'RegexLit', text: t.text, start: t.start, end: t.end }
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
      // `markdown { … }` (M6.3) — sibling to `style { ... }`. The lexer
      // emitted the body as a single MarkdownText token; codegen passes
      // it through markdown-it at build time.
      if (name === 'markdown' && this.tokens[this.pos + 1]?.kind === TokenKind.MarkdownText) {
        return this.parseMarkdownBlock(nameTok)
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
   *
   * M6.1: components accept TWO calling conventions:
   *   1. **Named-arg** (HTML-tag style): `Card(title: "hi", footer: …)`
   *      → `namedArgs: Prop[]`. Codegen emits a single props object.
   *   2. **Positional** (legacy): `Card("hi", body)` → `args: Expr[]`.
   *      Codegen emits `Card("hi", body)` unchanged for back-compat.
   *
   * The two forms are detected by peeking at the first arg shape: an
   * `Ident :` opener triggers the named-arg path; anything else falls
   * through to positional.
   */
  private parseComponentCall(nameTok: Token, hasParens: boolean): CallExpr {
    const args: Expr[] = []
    let namedArgs: Prop[] | undefined
    let endTok: Token = nameTok
    if (hasParens) {
      this.expect(TokenKind.LParen)
      // Detect named-arg shape: `Ident :` at args head means caller is
      // using HTML-tag-style named props. Mirrors `peekCallShape` for
      // lowercase tag-calls but anchored on a capitalized callee so it
      // can't collide with positional calls of plain functions.
      const t1 = this.peek()
      const t2 = this.tokens[this.pos + 1]
      const looksNamed =
        t1.kind === TokenKind.Ident &&
        t2 !== undefined &&
        t2.kind === TokenKind.Colon
      if (looksNamed) {
        namedArgs = []
        while (this.peek().kind !== TokenKind.RParen) {
          namedArgs.push(this.parseProp())
          if (this.peek().kind === TokenKind.Comma) this.pos++
        }
      } else {
        while (this.peek().kind !== TokenKind.RParen) {
          args.push(this.parseSpreadOrExpr())
          if (this.peek().kind === TokenKind.Comma) this.pos++
        }
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
    if (namedArgs !== undefined) result.namedArgs = namedArgs
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

  private parseMarkdownBlock(mdTok: Token): MarkdownBlock {
    this.expect(TokenKind.LBrace)
    const mdText = this.expect(TokenKind.MarkdownText)
    const rbrace = this.expect(TokenKind.RBrace)
    return {
      kind: 'MarkdownBlock',
      source: mdText.value as string,
      start: mdTok.start,
      end: rbrace.end,
      bodyStart: mdText.start,
      bodyEnd: mdText.end,
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
      args.push(this.parseSpreadOrExpr())
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
    const nameTok = this.expect(TokenKind.Ident)
    this.expect(TokenKind.Colon)
    // Use parseExpr (not parsePrimary) so prop values can be lambdas,
    // arithmetic, conditional expressions, etc. — e.g.
    // `onClick: () => count = count + 1`.
    const value = this.parseExpr()
    return {
      name: nameTok.text,
      value,
      nameStart: nameTok.start,
      nameEnd: nameTok.end,
    }
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
  const program = new Parser(tokens, source, filename).parseProgram()
  validateNoAny(program, source, filename)
  return program
}

/**
 * M9 Phase A polish — reject explicit `: any` in Tu source EXCEPT
 * inside `external JS` lambda signatures (the escape hatch). Walks
 * every captured raw-type slice in the AST and throws a directive
 * error pointing at `unknown` + the M8 `type.as` flow.
 *
 * Conservative: only flags whole-word `any`. `Array<any>` triggers,
 * `MyAnyClass` does not. Inline object-literal shapes inside type
 * spans (`{ x: any }`) are caught as part of the parent slice.
 */
function validateNoAny(program: Program, source: string, filename?: string): void {
  const anyRe = /\bany\b/
  const check = (text: string | undefined, start: number | undefined): void => {
    if (text === undefined) return
    if (!anyRe.test(text)) return
    const pos = (start ?? 0) + text.search(anyRe)
    const lc = pos >= 0 ? formatErrorLineCol(source, pos) : { line: 1, col: 1 }
    throw new Error(
      `${filename ?? 'input.tu'}:${lc.line}:${lc.col}: '${text.match(anyRe)![0]}' is banned in Tu source — use \`unknown\` for unknown values + \`type.as(v, T)\` for runtime narrowing. Inside \`external JS { … }\` block bodies + their lambda SIGNATURES \`any\` is allowed (escape hatch).`
    )
  }
  for (const stmt of program.body) {
    if (stmt.kind === 'LetDecl') {
      check(stmt.type, (stmt as LetDecl).typeStart)
      walkExprForAny(stmt.value, check)
    } else if (stmt.kind === 'TypeAlias') {
      check(stmt.type, stmt.typeStart)
    } else if (stmt.kind === 'InterfaceDecl' || stmt.kind === 'ExceptionDecl') {
      for (const f of stmt.fields) check(f.rawType, f.typeStart)
    }
  }
}

function walkExprForAny(
  expr: Expr,
  check: (t: string | undefined, start: number | undefined) => void
): void {
  // Skip ExternalLambda — its params/returnType are inside the
  // escape hatch.
  if (expr.kind === 'ExternalLambda') return
  if (expr.kind === 'Lambda') {
    for (const p of expr.params) check(p.type, p.nameStart)
    check(expr.returnType, expr.returnTypeStart)
    check(expr.throwsType, expr.throwsTypeStart)
    walkExprForAny(expr.body, check)
    return
  }
  // Generic recursion: iterate plausible-Expr-bearing fields.
  for (const v of Object.values(expr as object)) {
    if (v && typeof v === 'object') {
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item && typeof item === 'object' && 'kind' in item)
            walkExprForAny(item as Expr, check)
          else if (item && typeof item === 'object' && 'value' in item) {
            // Prop / ObjectProp shape
            const p = item as { value?: Expr }
            if (p.value && typeof p.value === 'object' && 'kind' in p.value)
              walkExprForAny(p.value, check)
          }
        }
      } else if ('kind' in v) {
        walkExprForAny(v as Expr, check)
      }
    }
  }
}

/** Tiny line/col helper without pulling in diagnostics.ts (avoids
 *  a circular import). Counts newlines up to byte offset. */
function formatErrorLineCol(source: string, offset: number): { line: number; col: number } {
  let line = 1
  let col = 1
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source.charCodeAt(i) === 0x0a) {
      line++
      col = 1
    } else {
      col++
    }
  }
  return { line, col }
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
  if (expr.kind === 'MethodCallExpr') return true
  if (expr.kind === 'IndexExpr') return true
  if (expr.kind === 'ObjectLit') return true
  if (expr.kind === 'ArrayLit') return true
  // `(await fetch(url)).json()` — await yields a value and the parens
  // around it dropped the syntactic boundary; same logic for `import()`
  // and `new T()` results which are also values worth member-accessing.
  if (expr.kind === 'AwaitExpr') return true
  if (expr.kind === 'ImportExpr') return true
  if (expr.kind === 'NewExpr') return true
  if (expr.kind === 'TemplateLit') return true
  if (expr.kind === 'RegexLit') return true
  // `(lambda)()` IIFE-style invocation, `(lambda).bind(this)` etc.
  if (expr.kind === 'Lambda') return true
  // `x!.foo` / `x!()` — the non-null assertion preserves the underlying
  // expression's accessibility for chaining.
  if (expr.kind === 'NonNullAssertExpr') return true
  // `(x as Foo).bar` — same logic; cast preserves accessibility.
  if (expr.kind === 'AsExpr') return true
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
