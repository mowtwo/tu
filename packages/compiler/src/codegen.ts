import type {
  BinaryExpr,
  Block,
  CallExpr,
  Child,
  Expr,
  Lambda,
  Program,
  Prop,
  Stmt,
  TagCall,
} from './ast.js'

const RUNTIME_IMPORT = `import { h, Signal } from '@tu/runtime'`

/**
 * Top-level binding kinds — drives whether an identifier read becomes
 * `name.get()` or stays as a plain reference.
 */
type CellKind = 'state' | 'computed' | 'function'

export function generate(program: Program): string {
  const cells = analyzeProgram(program)
  const cg = new Codegen(cells)
  const out: string[] = []
  out.push(RUNTIME_IMPORT)
  out.push('')
  for (const stmt of program.body) {
    out.push(cg.emitStmt(stmt))
  }
  out.push('')
  return out.join('\n')
}

function analyzeProgram(program: Program): Map<string, CellKind> {
  const cells = new Map<string, CellKind>()
  for (const stmt of program.body) {
    if (stmt.kind === 'LetDecl') {
      cells.set(stmt.name, classifyValue(stmt.value))
    }
  }
  return cells
}

function classifyValue(expr: Expr): CellKind {
  if (expr.kind === 'Lambda') return 'function'
  if (expr.kind === 'CallExpr' && expr.callee === 'computed') return 'computed'
  return 'state'
}

class Codegen {
  /** Stack of binding-name sets shadowing top-level cells (innermost last). */
  private readonly shadowed: Set<string>[] = []

  constructor(private readonly cells: Map<string, CellKind>) {}

  emitStmt(stmt: Stmt): string {
    const decl = stmt
    const prefix = decl.exported ? 'export const' : 'const'
    const kind = this.cells.get(decl.name) ?? 'state'
    if (kind === 'function') {
      return `${prefix} ${decl.name} = ${this.emitExpr(decl.value)}`
    }
    if (kind === 'computed') {
      const v = decl.value as CallExpr
      const arg = v.args[0]
      const body = arg ? this.emitExpr(arg) : 'undefined'
      return `${prefix} ${decl.name} = new Signal.Computed(() => ${body})`
    }
    // state
    return `${prefix} ${decl.name} = new Signal.State(${this.emitExpr(decl.value)})`
  }

  emitExpr(expr: Expr): string {
    switch (expr.kind) {
      case 'Lambda':
        return this.emitLambda(expr)
      case 'TagCall':
        return this.emitTagCall(expr)
      case 'CallExpr':
        return this.emitCallExpr(expr)
      case 'BinaryExpr':
        return this.emitBinaryExpr(expr)
      case 'StringLit':
        return JSON.stringify(expr.value)
      case 'NumberLit':
        return String(expr.value)
      case 'Ident':
        return this.emitIdentRead(expr.name)
      case 'Block':
        return this.emitBlock(expr)
    }
  }

  private emitLambda(node: Lambda): string {
    const params = node.params.map((p) => p.name)
    this.shadowed.push(new Set(params))
    try {
      const body = this.emitExpr(node.body)
      return `(${params.join(', ')}) => ${body}`
    } finally {
      this.shadowed.pop()
    }
  }

  private emitBlock(node: Block): string {
    if (node.body.length === 0) return '(undefined)'
    if (node.body.length === 1) {
      const only = node.body[0]
      if (!only) return '(undefined)'
      return `(${this.emitExpr(only)})`
    }
    const stmts = node.body.slice(0, -1).map((e) => `  ${this.emitExpr(e)};`)
    const last = node.body[node.body.length - 1]
    if (!last) return '(undefined)'
    return `(() => {\n${stmts.join('\n')}\n  return ${this.emitExpr(last)};\n})()`
  }

  private emitTagCall(node: TagCall): string {
    const tag = JSON.stringify(node.tag)
    const props = this.emitProps(node.props)
    const children = this.emitChildren(node.children)
    return `h(${tag}, ${props}, ${children})`
  }

  private emitCallExpr(node: CallExpr): string {
    const args = node.args.map((a) => this.emitExpr(a)).join(', ')
    return `${node.callee}(${args})`
  }

  private emitBinaryExpr(node: BinaryExpr): string {
    return `(${this.emitExpr(node.left)} ${node.op} ${this.emitExpr(node.right)})`
  }

  private emitProps(props: Prop[]): string {
    if (props.length === 0) return '{}'
    const entries = props.map((p) => `${JSON.stringify(p.name)}: ${this.emitExpr(p.value)}`)
    return `{ ${entries.join(', ')} }`
  }

  private emitChildren(children: Child[]): string {
    if (children.length === 0) return '[]'
    const items = children.map((c) => this.emitExpr(c))
    return `[${items.join(', ')}]`
  }

  /**
   * Emit an identifier read. If the name refers to a State or Computed cell
   * and is NOT shadowed by an enclosing lambda parameter, emit `.get()`.
   */
  private emitIdentRead(name: string): string {
    for (let i = this.shadowed.length - 1; i >= 0; i--) {
      if (this.shadowed[i]?.has(name)) return name
    }
    const kind = this.cells.get(name)
    if (kind === 'state' || kind === 'computed') return `${name}.get()`
    return name
  }
}
