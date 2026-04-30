import type { Block, Child, Expr, Lambda, Program, Prop, Stmt, TagCall } from './ast.js'

const RUNTIME_IMPORT = `import { h } from '@tu/runtime'`

export function generate(program: Program): string {
  const out: string[] = []
  out.push(RUNTIME_IMPORT)
  out.push('')
  for (const stmt of program.body) {
    out.push(emitStmt(stmt))
  }
  out.push('')
  return out.join('\n')
}

function emitStmt(stmt: Stmt): string {
  // M1.0: every top-level let is exported.
  const prefix = stmt.exported ? 'export const' : 'const'
  return `${prefix} ${stmt.name} = ${emitExpr(stmt.value)}`
}

function emitExpr(expr: Expr): string {
  switch (expr.kind) {
    case 'Lambda':
      return emitLambda(expr)
    case 'TagCall':
      return emitTagCall(expr)
    case 'StringLit':
      return JSON.stringify(expr.value)
    case 'NumberLit':
      return String(expr.value)
    case 'Ident':
      return expr.name
    case 'Block':
      return emitBlock(expr)
  }
}

function emitLambda(node: Lambda): string {
  const params = node.params.map((p) => p.name).join(', ')
  const body = emitExpr(node.body)
  return `(${params}) => ${body}`
}

function emitBlock(node: Block): string {
  if (node.body.length === 0) return '(undefined)'
  if (node.body.length === 1) {
    // Block is just a single expression — unwrap parentheses style.
    const only = node.body[0]
    if (!only) return '(undefined)'
    return `(${emitExpr(only)})`
  }
  // Multi-expression block: last expression is the value (ML/Rust style).
  const stmts = node.body.slice(0, -1).map((e) => `  ${emitExpr(e)};`)
  const last = node.body[node.body.length - 1]
  if (!last) return '(undefined)'
  return `(() => {\n${stmts.join('\n')}\n  return ${emitExpr(last)};\n})()`
}

function emitTagCall(node: TagCall): string {
  const tag = JSON.stringify(node.tag)
  const props = emitProps(node.props)
  const children = emitChildren(node.children)
  return `h(${tag}, ${props}, ${children})`
}

function emitProps(props: Prop[]): string {
  if (props.length === 0) return '{}'
  const entries = props.map((p) => `${JSON.stringify(p.name)}: ${emitExpr(p.value)}`)
  return `{ ${entries.join(', ')} }`
}

function emitChildren(children: Child[]): string {
  if (children.length === 0) return '[]'
  const items = children.map((c) => emitExpr(c))
  return `[${items.join(', ')}]`
}
