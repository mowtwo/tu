import type {
  BinaryExpr,
  BinaryOp,
  Block,
  CallExpr,
  Child,
  Expr,
  ForExpr,
  IfExpr,
  Lambda,
  MatchExpr,
  Program,
  Prop,
  Stmt,
  StyleBlock,
  TagCall,
} from './ast.js'

const RUNTIME_IMPORT = `import { h, Signal } from '@tu/runtime'`

/**
 * Top-level binding kinds — drives whether an identifier read becomes
 * `name.get()` or stays as a plain reference.
 */
type CellKind = 'state' | 'computed' | 'function'

/** Tu `==` / `!=` map to JS strict equality to avoid coercion surprises. */
const BINARY_OP_JS: Record<BinaryOp, string> = {
  '+': '+', '-': '-', '*': '*', '/': '/', '%': '%',
  '==': '===', '!=': '!==',
  '<': '<', '<=': '<=', '>': '>', '>=': '>=',
}

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
      case 'IfExpr':
        return this.emitIfExpr(expr)
      case 'ForExpr':
        return this.emitForExpr(expr)
      case 'MatchExpr':
        return this.emitMatchExpr(expr)
      case 'StyleBlock':
        return this.emitStyleBlock(expr)
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
    // A block containing one or more `style { … }` blocks emits as an array
    // fragment so each item (the main vnode + each style vnode) reaches the
    // renderer. The runtime flattens array children, so `[mainVNode, styleVNode]`
    // renders as siblings.
    if (node.body.some((e) => e.kind === 'StyleBlock')) {
      const items = node.body.map((e) => this.emitExpr(e))
      return `[${items.join(', ')}]`
    }
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

  private emitStyleBlock(node: StyleBlock): string {
    return `h("style", {}, [${JSON.stringify(node.css)}])`
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
    const op = BINARY_OP_JS[node.op]
    return `(${this.emitExpr(node.left)} ${op} ${this.emitExpr(node.right)})`
  }

  private emitIfExpr(node: IfExpr): string {
    const cond = this.emitExpr(node.cond)
    const thenJs = this.emitExpr(node.then)
    if (node.else === undefined) {
      return `(${cond} ? ${thenJs} : undefined)`
    }
    const elseJs = this.emitExpr(node.else)
    return `(${cond} ? ${thenJs} : ${elseJs})`
  }

  private emitForExpr(node: ForExpr): string {
    const iter = this.emitExpr(node.iter)
    this.shadowed.push(new Set([node.item]))
    try {
      const body = this.emitExpr(node.body)
      return `Array.from(${iter}, (${node.item}) => ${body})`
    } finally {
      this.shadowed.pop()
    }
  }

  private emitMatchExpr(node: MatchExpr): string {
    const scrut = this.emitExpr(node.scrutinee)
    const cases: string[] = []
    let hasWild = false
    for (const arm of node.arms) {
      const body = this.emitExpr(arm.body)
      if (arm.pattern.kind === 'PatWild') {
        cases.push(body)
        hasWild = true
        break
      }
      const lit = arm.pattern.value
      const litJs = lit.kind === 'StringLit' ? JSON.stringify(lit.value) : String(lit.value)
      cases.push(`__m === ${litJs} ? ${body}`)
    }
    if (!hasWild) cases.push('undefined')
    return `((__m) => ${cases.join(' : ')})(${scrut})`
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
