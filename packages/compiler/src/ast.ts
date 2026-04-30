export interface Program {
  kind: 'Program'
  body: Stmt[]
}

/**
 * Every AST node tracks the source byte range it spans. `start` is inclusive,
 * `end` is exclusive (the byte after the last consumed character). Used by
 * codegen to emit per-token source-map mappings, and by the LSP to squiggle
 * diagnostics on the offending token instead of the enclosing statement.
 */
interface Ranged {
  start: number
  end: number
}

export type Stmt = LetDecl | ImportDecl | ReExportDecl | TypeAlias

/**
 * `type Name = …` — a TS-style type alias. Tu doesn't parse the RHS itself;
 * the raw text between `=` and the next top-level statement is captured and
 * emitted verbatim into the TS shadow. JS mode erases the whole declaration.
 *
 * `export type` makes the alias publicly visible (mirrors `export let`).
 */
export interface TypeAlias extends Ranged {
  kind: 'TypeAlias'
  exported: boolean
  name: string
  /** Raw type expression text, captured between `=` and the next stmt boundary. */
  type: string
  /** Source byte range of the alias name. */
  nameStart: number
  nameEnd: number
  /** Source byte range of the type expression itself. */
  typeStart: number
  typeEnd: number
}

/**
 * `import { name1, name2 } from "./path.tu"` — V1 supports named imports
 * only. Default imports and `* as ns` namespace imports are intentionally
 * left out; they pair with feature work that hasn't landed yet (default
 * exports, member access).
 */
export interface ImportDecl extends Ranged {
  kind: 'ImportDecl'
  names: string[]
  source: string
}

/**
 * `export { name1, name2 } from "./other.tu"` — re-exports a set of names
 * from another module without binding them locally. Compiler emits the
 * same form in JS / TS.
 */
export interface ReExportDecl extends Ranged {
  kind: 'ReExportDecl'
  names: string[]
  source: string
}

export interface LetDecl extends Ranged {
  kind: 'LetDecl'
  /** Top-level lets are auto-exported in M1.0+. Will become opt-in via `export let` later. */
  exported: boolean
  name: string
  value: Expr
  /** Source byte range of the bound name (`X` in `export let X = …`). Drives
   *  token-level diagnostics that target only the binding name. */
  nameStart: number
  nameEnd: number
  /** Raw text of the type annotation between `:` and `=`, if the user
   *  supplied one (`let X: number = 0`). Captured as raw source bytes so it
   *  pipes through to the TS emit verbatim — Tu doesn't parse types itself.
   *  For lambdas the annotation is the const's type directly; for state /
   *  computed cells the codegen wraps it as `Signal.State<T>` / `Signal.Computed<T>`. */
  type?: string
  typeStart?: number
  typeEnd?: number
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
  | StyleBlock
  | AssignExpr
  | ClassRef
  | ArrayLit
  | ObjectLit

export interface Lambda extends Ranged {
  kind: 'Lambda'
  params: Param[]
  body: Expr
  /**
   * Optional return-type annotation between `)` and `=>` — `(x: number):
   * string => …`. Captured as a raw source slice (depth-tracked across
   * `()` / `{}` / `[]` / `<…>`) and emitted verbatim in TS mode; erased
   * in JS mode. Mirrors how `LetDecl.type` and `Param.type` work.
   */
  returnType?: string
  returnTypeStart?: number
  returnTypeEnd?: number
}

export interface Param extends Ranged {
  name: string
  /** Type annotation as a raw identifier ('string', 'number'…) — full type AST lands later. */
  type?: string
  /** Source byte range of the param name only (without the `: type` suffix). */
  nameStart: number
  nameEnd: number
}

export interface Block extends Ranged {
  kind: 'Block'
  /**
   * Sequence of items in source order. Plain expressions evaluate left-to-
   * right; the LAST item's value is the block's return value (Rust-style
   * implicit return). `LocalLet` items declare block-scoped const bindings
   * accessible to later items — the workhorse for closures and local
   * computation that doesn't belong at the module top level.
   */
  body: BlockItem[]
}

export type BlockItem = Expr | LocalLet

/**
 * `let X = expr` written INSIDE a block body. Compiles to a JS `const`,
 * not a reactive cell — local lets are plain values. Type annotations are
 * supported via the same raw-source-slice mechanism as top-level lets.
 *
 * Local lets MUST appear inside a `Block`; the parser only accepts them
 * there. They have no `exported` field — local visibility is implicit.
 */
export interface LocalLet extends Ranged {
  kind: 'LocalLet'
  name: string
  value: Expr
  nameStart: number
  nameEnd: number
  type?: string
  typeStart?: number
  typeEnd?: number
}

export interface TagCall extends Ranged {
  kind: 'TagCall'
  tag: string
  props: Prop[]
  children: Child[]
  /** Source byte range of the tag identifier itself (`div` in `div(…)`). */
  tagStart: number
  tagEnd: number
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
  | StyleBlock
  | ClassRef
  | ArrayLit
  | ObjectLit

export interface CallExpr extends Ranged {
  kind: 'CallExpr'
  callee: string
  args: Expr[]
  /** Source byte range of the callee identifier. */
  calleeStart: number
  calleeEnd: number
  /**
   * Trailing children block, present only for **component** invocations
   * (capitalized callee). The compiler emits these as the last positional
   * argument: `Callee(...args, [...children])`. Components by convention
   * accept a final `children` parameter to receive this array.
   *
   * Plain function calls (lowercase callees that aren't HTML tags) stay
   * `children: undefined` — they don't accept a trailing block.
   */
  children?: Child[]
}

export type BinaryOp =
  | '+' | '-' | '*' | '/' | '%'
  | '==' | '!=' | '<' | '<=' | '>' | '>='

export interface BinaryExpr extends Ranged {
  kind: 'BinaryExpr'
  op: BinaryOp
  left: Expr
  right: Expr
}

export interface StringLit extends Ranged {
  kind: 'StringLit'
  value: string
}

export interface NumberLit extends Ranged {
  kind: 'NumberLit'
  value: number
}

export interface Ident extends Ranged {
  kind: 'Ident'
  name: string
}

export interface IfExpr extends Ranged {
  kind: 'IfExpr'
  cond: Expr
  then: Block
  else?: Block | IfExpr
}

export interface ForExpr extends Ranged {
  kind: 'ForExpr'
  /** Loop binding name. */
  item: string
  iter: Expr
  body: Block
  /** Source byte range of the loop binder name (`item` in `for item in …`). */
  itemStart: number
  itemEnd: number
}

/**
 * A `style { … }` block. The CSS body is preserved verbatim as raw text — the
 * compiler does not parse CSS in M1.4. Rendered as an HTML `<style>` element
 * sibling to the component's main vnode. `cssStart` / `cssEnd` mark the byte
 * range of the inner CSS text, so the LSP can slice it out for delegation
 * to a CSS language service.
 */
export interface StyleBlock extends Ranged {
  kind: 'StyleBlock'
  css: string
  cssStart: number
  cssEnd: number
}

/**
 * `target = value` in expression position. When the target resolves to a
 * top-level state cell, codegen emits `target.set(value)`; otherwise emits a
 * plain JS assignment.
 */
export interface AssignExpr extends Ranged {
  kind: 'AssignExpr'
  target: string
  value: Expr
  /** Source byte range of the assignment target identifier. */
  targetStart: number
  targetEnd: number
}

/**
 * `[a, b, c]` — array literal. Codegen emits the JS-equivalent literal
 * verbatim. Empty (`[]`) is allowed. Used in markup positions, the runtime
 * flattens arrays so `div { [1, 2] }` renders as two siblings.
 */
export interface ArrayLit extends Ranged {
  kind: 'ArrayLit'
  elements: Expr[]
}

/**
 * `{ key: value, "k-2": expr }` — object literal. Disambiguated from a
 * `Block` by lookahead: an opener of `{ }`, `{ Ident :`, or `{ String :`
 * triggers ObjectLit, anything else (including `{ x }` and `{ stmt; … }`)
 * stays a Block. Shorthand (`{ x }`), computed keys (`{ [k]: v }`), and
 * spread (`{ ...rest }`) are tracked in `docs/DEFERRED.md`.
 */
export interface ObjectLit extends Ranged {
  kind: 'ObjectLit'
  properties: ObjectProp[]
}

/**
 * One `key: value` pair inside an `ObjectLit`. The key is captured as an
 * already-decoded string. `keyKind` lets codegen choose between bare-ident
 * emit (`{ x: 1 }`) and quoted emit (`{ "data-id": 1 }`); also lets future
 * IDE features know when a key was a string literal vs identifier.
 */
export interface ObjectProp {
  key: string
  keyKind: 'ident' | 'string'
  value: Expr
  /** Source byte range of the key token (used for token-level mapping). */
  keyStart: number
  keyEnd: number
}

/**
 * `.foo` — a symbolic reference to a class declared in the enclosing
 * component's `style { … }` block. At codegen time, scoped components rewrite
 * each ClassRef to a hashed string literal that matches the rewritten CSS
 * selectors — so markup and styles stay in lock-step under scoping.
 */
export interface ClassRef extends Ranged {
  kind: 'ClassRef'
  name: string
}
