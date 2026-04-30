export interface Program {
  kind: 'Program'
  body: Stmt[]
}

export type Stmt = LetDecl

export interface LetDecl {
  kind: 'LetDecl'
  /** Top-level lets are auto-exported in M1.0+. Will become opt-in via `export let` later. */
  exported: boolean
  name: string
  value: Expr
}

export type Expr =
  | Lambda
  | TagCall
  | CallExpr
  | BinaryExpr
  | StringLit
  | NumberLit
  | Ident
  | Block
  | IfExpr
  | ForExpr
  | MatchExpr
  | StyleBlock
  | AssignExpr
  | ClassRef

export interface Lambda {
  kind: 'Lambda'
  params: Param[]
  body: Expr
}

export interface Param {
  name: string
  /** Type annotation as a raw identifier ('string', 'number'…) — full type AST lands later. */
  type?: string
}

export interface Block {
  kind: 'Block'
  body: Expr[]
}

export interface TagCall {
  kind: 'TagCall'
  tag: string
  props: Prop[]
  children: Child[]
}

export interface Prop {
  name: string
  value: Expr
}

export type Child =
  | TagCall
  | CallExpr
  | BinaryExpr
  | StringLit
  | NumberLit
  | Ident
  | IfExpr
  | ForExpr
  | MatchExpr
  | StyleBlock
  | ClassRef

export interface CallExpr {
  kind: 'CallExpr'
  callee: string
  args: Expr[]
}

export type BinaryOp =
  | '+' | '-' | '*' | '/' | '%'
  | '==' | '!=' | '<' | '<=' | '>' | '>='

export interface BinaryExpr {
  kind: 'BinaryExpr'
  op: BinaryOp
  left: Expr
  right: Expr
}

export interface StringLit {
  kind: 'StringLit'
  value: string
}

export interface NumberLit {
  kind: 'NumberLit'
  value: number
}

export interface Ident {
  kind: 'Ident'
  name: string
}

export interface IfExpr {
  kind: 'IfExpr'
  cond: Expr
  then: Block
  else?: Block | IfExpr
}

export interface ForExpr {
  kind: 'ForExpr'
  /** Loop binding name. */
  item: string
  iter: Expr
  body: Block
}

export interface MatchExpr {
  kind: 'MatchExpr'
  scrutinee: Expr
  arms: MatchArm[]
}

export type MatchPattern =
  | { kind: 'PatLit'; value: StringLit | NumberLit }
  | { kind: 'PatWild' }

export interface MatchArm {
  pattern: MatchPattern
  body: Expr
}

/**
 * A `style { … }` block. The CSS body is preserved verbatim as raw text — the
 * compiler does not parse CSS in M1.4. Rendered as an HTML `<style>` element
 * sibling to the component's main vnode.
 */
export interface StyleBlock {
  kind: 'StyleBlock'
  css: string
}

/**
 * `target = value` in expression position. When the target resolves to a
 * top-level state cell, codegen emits `target.set(value)`; otherwise emits a
 * plain JS assignment.
 */
export interface AssignExpr {
  kind: 'AssignExpr'
  target: string
  value: Expr
}

/**
 * `.foo` — a symbolic reference to a class declared in the enclosing
 * component's `style { … }` block. At codegen time, scoped components rewrite
 * each ClassRef to a hashed string literal that matches the rewritten CSS
 * selectors — so markup and styles stay in lock-step under scoping.
 */
export interface ClassRef {
  kind: 'ClassRef'
  name: string
}
