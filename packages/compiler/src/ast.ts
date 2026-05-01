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
  | MarkdownBlock
  | AssignExpr
  | ClassRef
  | ArrayLit
  | ObjectLit
  | MemberExpr
  | MethodCallExpr
  | UnaryExpr
  | NonNullAssertExpr
  | IndexExpr
  | ThrowExpr
  | ReturnExpr
  | TryExpr

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
  /** Source byte range of the prop name identifier. Optional for back-
   *  compat with code paths that synthesize Prop without a token (e.g.
   *  pug-shorthand class injection). LSP hover uses this to decide
   *  whether the cursor is on a tag-call attribute. */
  nameStart?: number
  nameEnd?: number
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
  | MarkdownBlock
  | ClassRef
  | ArrayLit
  | ObjectLit
  | MemberExpr
  | MethodCallExpr
  | UnaryExpr
  | NonNullAssertExpr
  | IndexExpr
  | ThrowExpr
  | ReturnExpr
  | TryExpr

export interface CallExpr extends Ranged {
  kind: 'CallExpr'
  callee: string
  args: Expr[]
  /** Source byte range of the callee identifier. */
  calleeStart: number
  calleeEnd: number
  /**
   * **M6.1 named-arg call form.** `Card(title: "hi", footer: () => …)`
   * parses each `name: value` pair into this list. Codegen emits
   * `Card({ title: "hi", footer: …, children: [...] })`. Either `args`
   * (legacy positional) OR `namedArgs` (M6.1) is non-empty, never both.
   */
  namedArgs?: Prop[]
  /**
   * Trailing children block, present only for **component** invocations
   * (capitalized callee). For positional callsites the compiler emits
   * these as the last positional argument: `Callee(...args, [...children])`.
   * For named callsites (M6.1), they're merged into the props object as
   * `children: [...]`. Plain function calls (lowercase callees that
   * aren't HTML tags) stay `children: undefined`.
   */
  children?: Child[]
}

export type BinaryOp =
  | '+' | '-' | '*' | '/' | '%'
  | '==' | '!=' | '<' | '<=' | '>' | '>='
  | '||' | '&&' | '??'

export interface BinaryExpr extends Ranged {
  kind: 'BinaryExpr'
  op: BinaryOp
  left: Expr
  right: Expr
}

/** Prefix unary — `!` (logical NOT), `-` (numeric negation), `+`
 *  (numeric coercion). Each emits as the matching JS operator, with the
 *  arg wrapped in parens so larger expressions compose correctly. */
export interface UnaryExpr extends Ranged {
  kind: 'UnaryExpr'
  op: '!' | '-' | '+'
  arg: Expr
}

/** Postfix `!` — TypeScript's non-null assertion. Erased in JS-emit
 *  mode; preserved verbatim in TS-emit mode so tsserver's flow analysis
 *  picks it up. Has no runtime effect. */
export interface NonNullAssertExpr extends Ranged {
  kind: 'NonNullAssertExpr'
  arg: Expr
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
 * **M6.3** A `markdown { … }` block. The CSS-style raw-text lexing
 * collects the inner body verbatim; the codegen runs it through a real
 * markdown parser (markdown-it) at compile time and emits the result
 * as a `$static` vnode (M6.0 path), so the runtime sees a
 * pre-rendered HTML string ready to mount via `<template>` clone.
 *
 * Same shape as `StyleBlock`: special-form, single contiguous token
 * pair (`markdown` ident + LBrace + MarkdownText + RBrace), preserves
 * source byte ranges of the inner content for source-map fidelity.
 *
 * No interpolation in V1 — the body is purely literal markdown. Mixing
 * Tu values into prose comes later (probably via leading-frontmatter
 * + per-page Tu state cells, the way astro / mdx do).
 */
export interface MarkdownBlock extends Ranged {
  kind: 'MarkdownBlock'
  /** Raw markdown text (no leading/trailing braces). */
  source: string
  /** Source byte range of the inner markdown text. */
  bodyStart: number
  bodyEnd: number
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

/**
 * `obj.foo` — postfix member access. `.` is unambiguous here because
 * ClassRef's `.foo` is a *prefix* dot (recognized by `parsePrefix`),
 * whereas member access is parsed as a postfix loop after any expression
 * that yields a value. Codegen emits `obj.foo` directly; the leaf cell
 * ident inside `object` still receives `.get()` injection per the usual
 * cell-read rules — the property name is plain.
 */
export interface MemberExpr extends Ranged {
  kind: 'MemberExpr'
  object: Expr
  property: string
  /** Source byte range of the property name. */
  propertyStart: number
  propertyEnd: number
  /** True when this access used `?.` instead of `.`. Codegen emits the
   *  optional-chaining operator; if absent the access is non-optional. */
  optional?: boolean
}

/** Computed-key access — `obj[expr]` or `obj?.[expr]`. Distinct from
 *  `MemberExpr` because the key is an arbitrary expression rather than
 *  a static identifier. */
export interface IndexExpr extends Ranged {
  kind: 'IndexExpr'
  object: Expr
  index: Expr
  optional?: boolean
}

/** `throw expr` — JS-spec is statement-only, but Tu treats it as an
 *  expression so it can sit in if-branches / value positions. Codegen
 *  emits a clean `throw …;` statement when the parent context is a
 *  Block (the common case); otherwise it auto-wraps in an IIFE. */
export interface ThrowExpr extends Ranged {
  kind: 'ThrowExpr'
  arg: Expr
}

/** Early `return` from inside a lambda body. Same expression-vs-stmt
 *  treatment as `ThrowExpr` — clean `return …;` inside Block, IIFE-
 *  wrapped elsewhere. The optional `value` lets users write bare
 *  `return` (returning undefined). */
export interface ReturnExpr extends Ranged {
  kind: 'ReturnExpr'
  value?: Expr
}

/** `try { … } catch (e: T) { … } finally { … }` as an expression. The
 *  `try` body is required; either or both of catch/finally may be
 *  present. Codegen wraps in an IIFE so the resulting value can flow
 *  into `let x = try { … } catch (e) { … }`. */
export interface TryExpr extends Ranged {
  kind: 'TryExpr'
  body: Block
  catchClause?: TryCatchClause
  finallyClause?: Block
}

export interface TryCatchClause {
  /** Bound name for the caught error. Empty string when the user
   *  wrote bare `catch { … }` (an ECMAScript feature since 2019). */
  param: string
  paramStart: number
  paramEnd: number
  /** Optional TS type annotation for the param — emitted only in
   *  TS-shadow mode. */
  type?: string
  body: Block
}

/**
 * **M5.9 method call** — `obj.method(arg1, arg2)` parsed as a postfix
 * `(...)` immediately after a member-access dot. Common forms:
 *   `e.preventDefault()`, `props.onChange(v)`, `arr.map(fn)`,
 *   `console.log(x)`. The parser disambiguates from plain member access
 *   in the postfix loop: `.Ident` followed by `(` collapses into one
 *   MethodCallExpr; without `(` the result stays a MemberExpr.
 *
 * Codegen: emit `<object>.method(args)`. The leaf cell ident inside
 * `object` still receives `.get()` injection per usual rules — the
 * property name is plain JS.
 */
export interface MethodCallExpr extends Ranged {
  kind: 'MethodCallExpr'
  object: Expr
  property: string
  args: Expr[]
  /** Source byte range of the method name. */
  propertyStart: number
  propertyEnd: number
  /** True when the call used `?.method(args)` instead of `.method(args)`. */
  optional?: boolean
}
