// M9 Exception scope checker (Phase 4).
//
// Walks every top-level Lambda in a Tu program, collects the set of
// `throw <Ident>(…)` sites where the callee resolves to a declared
// `Exception` in the same file, and validates that set against the
// lambda's declared `throwsType` clause (`(): R ? E1 | E2 => …`).
//
// What it catches in v1:
//   - `throw NotFoundError(…)` inside a function whose throws clause
//     omits NotFoundError → diagnostic on the throw site.
//   - Function declares `: R ? AError` but never throws AError →
//     informational only (not flagged — over-declaration is harmless).
//
// Out of scope for v1 (Phase 4 follow-up):
//   - Cross-module propagation: `let f = () => g()` where g() throws.
//     v1 ignores call-site propagation; users must declare locally.
//   - Try/catch filtering. v1 assumes any throw inside a `try { … }`
//     body is caught — over-conservative but safe (no false positives).
//   - Throws from anonymous lambda values not bound to a declared name.
//
// The aim is to surface the most common authoring mistake (declaring
// a function pure when it actually throws) without blocking the user
// on edge cases the cross-module work hasn't reached yet.

import type {
  Block,
  CallExpr,
  Expr,
  ExceptionDecl,
  Lambda,
  LetDecl,
  Program,
  Stmt,
  ThrowExpr,
} from '@tu-lang/compiler'
import { lineColAt } from '@tu-lang/compiler'
import type { TuDiagnostic } from './diagnostics.js'

/**
 * Walk `program` and emit diagnostics for any `throw KnownException(…)`
 * site that violates its enclosing function's declared throws clause.
 */
export function checkExceptionScope(program: Program, source: string): TuDiagnostic[] {
  const declaredExceptions = collectDeclaredExceptions(program)
  if (declaredExceptions.size === 0) return []
  const diags: TuDiagnostic[] = []
  for (const stmt of program.body) {
    if (stmt.kind !== 'LetDecl') continue
    if (stmt.value.kind !== 'Lambda') continue
    walkLambda(stmt, stmt.value, declaredExceptions, diags, source)
  }
  return diags
}

function collectDeclaredExceptions(program: Program): Set<string> {
  const out = new Set<string>()
  for (const stmt of program.body) {
    if (stmt.kind === 'ExceptionDecl') out.add(stmt.name)
  }
  return out
}

function walkLambda(
  decl: LetDecl,
  lambda: Lambda,
  declaredExceptions: Set<string>,
  diags: TuDiagnostic[],
  source: string
): void {
  // Parse the declared throws clause into a name set. `null` means
  // the function didn't declare any throws clause — under strict
  // mode we'd require a clause, but v1 is lenient (only validates
  // when declared).
  const declared = lambda.throwsType ? parseThrowsClause(lambda.throwsType) : null
  const throws = collectThrowsInBody(lambda.body, declaredExceptions)
  if (declared === null) {
    // No declared clause — over-thrown errors aren't flagged in v1.
    // (Phase 4b will warn / auto-suggest a clause.)
    return
  }
  for (const { name, throwExpr } of throws) {
    if (declared.has(name)) continue
    // Diagnostic: throw is not in declared throws clause.
    const lc = lineColAt(source, throwExpr.start)
    diags.push({
      line: lc.line - 1,
      col: lc.col - 1,
      length: throwExpr.end - throwExpr.start,
      severity: 'error',
      code: -1,
      message:
        `'${decl.name}' throws ${name} but its declared throws clause ` +
        `(${[...declared].join(' | ')}) doesn't include it. Add ${name} to ` +
        `the clause: \`(${(lambda.params.map((p) => p.name).join(', '))}): ${
          lambda.returnType ?? 'unknown'
        } ? ${[...declared, name].join(' | ')} => …\`. ` +
        `(Or wrap the throw in a \`try { … } catch (e: ${name}) { … }\`.)`,
    })
  }
}

function parseThrowsClause(text: string): Set<string> {
  // Throws clause is a `|`-separated list of identifier names —
  // `AError | BError`. Whitespace tolerated. Treat anything more
  // exotic (generics, function types, etc.) as an opaque single
  // entry; v1's checker is identifier-pattern-only.
  const out = new Set<string>()
  for (const part of text.split('|')) {
    const trimmed = part.trim()
    if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) out.add(trimmed)
  }
  return out
}

interface ThrowSite {
  name: string
  throwExpr: ThrowExpr
}

function collectThrowsInBody(
  body: Expr,
  declaredExceptions: Set<string>
): ThrowSite[] {
  const out: ThrowSite[] = []
  // Inside a `try { … } catch { … }` we OPTIMISTICALLY assume the
  // catch handles every throw. Over-conservative for the user's
  // intent but eliminates false positives in v1. Phase 4b will
  // refine to filter caught types.
  walkExpr(body, out, declaredExceptions, /*insideTry*/ false)
  return out
}

function walkExpr(
  expr: Expr,
  out: ThrowSite[],
  declaredExceptions: Set<string>,
  insideTry: boolean
): void {
  switch (expr.kind) {
    case 'ThrowExpr': {
      if (insideTry) return // assume caught
      const name = inferThrowName(expr.arg, declaredExceptions)
      if (name !== null) {
        out.push({ name, throwExpr: expr })
      }
      walkExpr(expr.arg, out, declaredExceptions, insideTry)
      return
    }
    case 'TryExpr': {
      // Body throws are assumed caught; walk catch + finally normally.
      walkBlock(expr.body, out, declaredExceptions, /*insideTry*/ true)
      if (expr.catchClause) {
        walkBlock(expr.catchClause.body, out, declaredExceptions, insideTry)
      }
      if (expr.finallyClause) {
        walkBlock(expr.finallyClause, out, declaredExceptions, insideTry)
      }
      return
    }
    case 'Block': {
      walkBlock(expr, out, declaredExceptions, insideTry)
      return
    }
    case 'IfExpr': {
      walkExpr(expr.cond, out, declaredExceptions, insideTry)
      walkExpr(expr.then, out, declaredExceptions, insideTry)
      if (expr.else) walkExpr(expr.else, out, declaredExceptions, insideTry)
      return
    }
    case 'ForExpr': {
      walkExpr(expr.iter, out, declaredExceptions, insideTry)
      walkExpr(expr.body, out, declaredExceptions, insideTry)
      return
    }
    case 'CallExpr': {
      const call = expr as CallExpr
      // CallExpr.callee is a STRING (the bare identifier name), not an
      // expression — skip walking it. Args / children / namedArgs are
      // the only expression slots.
      for (const arg of call.args) walkExpr(arg, out, declaredExceptions, insideTry)
      if (call.children) {
        for (const child of call.children)
          walkExpr(child as Expr, out, declaredExceptions, insideTry)
      }
      if (call.namedArgs) {
        for (const p of call.namedArgs)
          walkExpr(p.value, out, declaredExceptions, insideTry)
      }
      return
    }
    case 'BinaryExpr': {
      walkExpr(expr.left, out, declaredExceptions, insideTry)
      walkExpr(expr.right, out, declaredExceptions, insideTry)
      return
    }
    case 'UnaryExpr':
    case 'AwaitExpr':
    case 'AsExpr':
      walkExpr(expr.arg, out, declaredExceptions, insideTry)
      return
    case 'Lambda':
      // Inner lambdas have their own throws scope — don't propagate
      // their throws to the outer function.
      return
    case 'TagCall': {
      for (const prop of expr.props) walkExpr(prop.value, out, declaredExceptions, insideTry)
      for (const child of expr.children) walkExpr(child as Expr, out, declaredExceptions, insideTry)
      return
    }
    case 'AssignExpr':
      walkExpr(expr.value, out, declaredExceptions, insideTry)
      return
    case 'MemberExpr':
      walkExpr(expr.object, out, declaredExceptions, insideTry)
      return
    case 'TernaryExpr':
      // M9 banned ternary, but the AST still exists for parser cleanup.
      // Defensive: walk the branches if encountered.
      walkExpr(expr.cond, out, declaredExceptions, insideTry)
      walkExpr(expr.then, out, declaredExceptions, insideTry)
      walkExpr(expr.else, out, declaredExceptions, insideTry)
      return
    default:
      // Atomic / unrecognized — nothing to descend.
      return
  }
}

function walkBlock(
  block: Block,
  out: ThrowSite[],
  declaredExceptions: Set<string>,
  insideTry: boolean
): void {
  for (const item of block.body) {
    if (item.kind === 'LocalLet') {
      walkExpr(item.value, out, declaredExceptions, insideTry)
    } else {
      walkExpr(item as Expr, out, declaredExceptions, insideTry)
    }
  }
}

function inferThrowName(
  arg: Expr,
  declaredExceptions: Set<string>
): string | null {
  // Pattern: `throw KnownException(…)` — the arg is a CallExpr whose
  // callee is a Tu identifier (string) matching a declared Exception
  // in scope. CallExpr.callee is captured as a string, not an Expr.
  if (arg.kind === 'CallExpr' && typeof arg.callee === 'string') {
    if (declaredExceptions.has(arg.callee)) return arg.callee
  }
  return null
}

// Re-export for the caller.
export type { ExceptionDecl, Stmt }
