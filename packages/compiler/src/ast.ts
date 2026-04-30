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

export type Child = TagCall | CallExpr | BinaryExpr | StringLit | NumberLit | Ident

export interface CallExpr {
  kind: 'CallExpr'
  callee: string
  args: Expr[]
}

export type BinaryOp = '+' | '-' | '*' | '/' | '%'

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
