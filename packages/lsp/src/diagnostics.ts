import { compileToTSWithMap, lineColAt, parse, tokenize, type Child, type Expr, type Program, type Stmt } from '@tu-lang/compiler'
import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import ts from 'typescript'
import { validateCssBlocks } from './css-lsp.js'
import { checkExceptionScope } from './exception-scope.js'
import { mapTSRangeToSource } from './source-map.js'
import {
  buildShadowGraph,
  getTuCompilerOptions,
  tuPathToTs,
  type Shadow,
} from './shadow-graph.js'

export interface TuDiagnostic {
  /** 0-based line in the .tu source. */
  line: number
  /** 0-based column in the .tu source. */
  col: number
  /** Diagnostic length in `.tu` source bytes (not TS) — squiggle width. */
  length: number
  severity: 'error' | 'warning' | 'info' | 'hint'
  message: string
  /** TS error code (e.g. 2322), surfaced for diagnostic.code in the LSP. */
  code: number
}

/**
 * Type-check a single `.tu` source against its full import graph. The current
 * document's text is used verbatim; transitively-imported `.tu` files come
 * from `inMemorySources` (M6.12) when present, falling back to disk for any
 * import not in the editor's open-document store. Returns diagnostics for
 * the root file only (cross-file errors land in the file that imports the
 * broken thing).
 */
export function checkTuSource(
  source: string,
  filename: string,
  inMemorySources?: ReadonlyMap<string, string>
): TuDiagnostic[] {
  // Normalize filename to absolute up-front so the BFS keys + the root
  // lookup agree (the BFS uses whatever filename it's given verbatim).
  const rootAbsPath = isAbsolute(filename) ? filename : resolve(process.cwd(), filename)
  let shadows: Map<string, Shadow>
  try {
    shadows = buildShadowGraph(source, rootAbsPath, inMemorySources)
  } catch (err) {
    // A Tu compile error on the ROOT file (the one being checked) surfaces
    // here. The error is already pre-formatted with file:line:col by M1.9.
    return [
      {
        line: 0,
        col: 0,
        length: 1,
        severity: 'error',
        message: err instanceof Error ? err.message : String(err),
        code: -1,
      },
    ]
  }
  const rootVirtualPath = tuPathToTs(rootAbsPath)
  const rootShadow = shadows.get(rootVirtualPath)
  if (!rootShadow) {
    // The root failed to compile inside buildShadowGraph (caught silently
    // there). Re-run compile so we can surface the formatted error.
    try {
      compileToTSWithMap(source, { filename })
    } catch (err) {
      return [
        {
          line: 0,
          col: 0,
          length: 1,
          severity: 'error',
          message: err instanceof Error ? err.message : String(err),
          code: -1,
        },
      ]
    }
    return []
  }
  const compilerOptions = getTuCompilerOptions()

  const host = ts.createCompilerHost(compilerOptions, true)
  const realGetSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => {
    const shadow = shadows.get(name)
    if (shadow) {
      return ts.createSourceFile(name, shadow.ts, languageVersion, true)
    }
    return realGetSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile)
  }
  const realFileExists = host.fileExists.bind(host)
  host.fileExists = (name) => shadows.has(name) || realFileExists(name)
  const realReadFile = host.readFile.bind(host)
  host.readFile = (name) => shadows.get(name)?.ts ?? realReadFile(name)

  const program = ts.createProgram({
    rootNames: [rootShadow.virtualPath],
    options: compilerOptions,
    host,
  })

  const tsDiagnostics = ts.getPreEmitDiagnostics(program)
  const tuDiags: TuDiagnostic[] = tsDiagnostics
    .filter((d) => d.file?.fileName === rootShadow.virtualPath)
    .map((d) => translateDiagnostic(d, rootShadow))

  // Augment with CSS diagnostics from any style blocks in the root file.
  // The checked source is the in-memory text we received, not the
  // shadow-graph copy on disk — keeps things consistent with what tsc saw.
  try {
    const ast = parse(tokenize(source, filename), source, filename)
    for (const cssDiag of validateCssBlocks(source, ast)) {
      tuDiags.push({
        line: cssDiag.line,
        col: cssDiag.col,
        length: cssDiag.length,
        severity: cssDiag.severity,
        message: cssDiag.message,
        // CSS LS doesn't carry TS-style numeric codes; surface a sentinel
        // so the LSP layer can suppress the `[code]` tag in its output.
        code: -1,
      })
    }
    // M9 Exception scope (Phase 4) — detect throws not declared in
    // the function's `(): R ? E1 | E2 => …` clause.
    for (const exDiag of checkExceptionScope(ast, source)) {
      tuDiags.push(exDiag)
    }
    for (const deprecationDiag of checkDeprecatedPositionalComponentCalls(ast, source)) {
      tuDiags.push(deprecationDiag)
    }
  } catch {
    // Already covered by the buildShadowGraph compile-error path above.
  }

  return tuDiags
}

function translateDiagnostic(d: ts.Diagnostic, shadow: Shadow): TuDiagnostic {
  const start = d.start ?? 0
  const length = d.length ?? 1
  // Token-level mapping: if a TokenMapping covers the diagnostic's TS span,
  // use that span's source range. Otherwise fall back to the per-statement
  // mapping (start point) and let the LSP layer expand it to the let header.
  const range = mapTSRangeToSource(
    shadow.tokenMappings,
    shadow.ts,
    shadow.tuSource,
    start,
    length,
    shadow.mapPos
  )
  return {
    line: range.line,
    col: range.col,
    length: range.length,
    severity:
      d.category === ts.DiagnosticCategory.Error
        ? 'error'
        : d.category === ts.DiagnosticCategory.Warning
          ? 'warning'
          : d.category === ts.DiagnosticCategory.Suggestion
            ? 'hint'
            : 'info',
    message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
    code: d.code,
  }
}

// Convenience: read .tu off disk and check.
export function checkTuFile(path: string): TuDiagnostic[] {
  const source = readFileSync(path, 'utf-8')
  return checkTuSource(source, path)
}

function checkDeprecatedPositionalComponentCalls(program: Program, source: string): TuDiagnostic[] {
  const out: TuDiagnostic[] = []
  const exceptionNames = new Set(
    program.body
      .filter((stmt) => stmt.kind === 'ExceptionDecl')
      .map((stmt) => stmt.name)
  )
  const visit = (expr: Expr): void => {
    switch (expr.kind) {
      case 'CallExpr':
        if (isDeprecatedPositionalComponentCall(expr, exceptionNames)) {
          const lc = lineColAt(source, expr.calleeStart)
          out.push({
            line: lc.line - 1,
            col: lc.col - 1,
            length: Math.max(1, expr.calleeEnd - expr.calleeStart),
            severity: 'warning',
            message:
              `positional component call '${expr.callee}(...)' is deprecated; ` +
              `use named props such as '${expr.callee}(prop: value)' and pass children with a trailing block.`,
            code: -1,
          })
        }
        for (const arg of expr.args) visit(arg)
        for (const arg of expr.namedArgs ?? []) visit(arg.value)
        for (const child of expr.children ?? []) visitChild(child)
        return
      case 'TagCall':
        for (const prop of expr.props) visit(prop.value)
        for (const child of expr.children) visitChild(child)
        return
      case 'Lambda':
        visit(expr.body)
        return
      case 'Block':
        for (const item of expr.body) {
          if (item.kind === 'LocalLet') visit(item.value)
          else visit(item)
        }
        return
      case 'ArrayLit':
        for (const item of expr.elements) visit(item)
        return
      case 'ObjectLit':
        for (const prop of expr.properties) {
          if (prop.kind === 'ObjectSpread') visit(prop.arg)
          else {
            if (prop.computedKey) visit(prop.computedKey)
            visit(prop.value)
          }
        }
        return
      case 'MemberExpr':
        visit(expr.object)
        return
      case 'IndexExpr':
        visit(expr.object)
        visit(expr.index)
        return
      case 'MethodCallExpr':
        visit(expr.object)
        for (const arg of expr.args) visit(arg)
        return
      case 'InvokeExpr':
        visit(expr.callee)
        for (const arg of expr.args) visit(arg)
        return
      case 'AssignExpr':
        visit(expr.value)
        return
      case 'MemberAssignExpr':
        visit(expr.target)
        visit(expr.value)
        return
      case 'BinaryExpr':
        visit(expr.left)
        visit(expr.right)
        return
      case 'UnaryExpr':
      case 'NonNullAssertExpr':
      case 'AsExpr':
      case 'AwaitExpr':
      case 'SpreadElement':
      case 'ThrowExpr':
      case 'NewExpr':
      case 'ImportExpr':
      case 'UpdateExpr':
        visit(expr.arg)
        return
      case 'IfExpr':
        visit(expr.cond)
        visit(expr.then)
        if (expr.else) visit(expr.else)
        return
      case 'ForExpr':
        visit(expr.iter)
        visit(expr.body)
        return
      case 'TryExpr':
        visit(expr.body)
        for (const c of expr.catchClauses ?? (expr.catchClause ? [expr.catchClause] : [])) visit(c.body)
        if (expr.finallyClause) visit(expr.finallyClause)
        return
      case 'TernaryExpr':
        visit(expr.cond)
        visit(expr.then)
        visit(expr.else)
        return
      case 'TemplateLit':
        for (const part of expr.expressions) visit(part)
        return
      case 'ReturnExpr':
        if (expr.value) visit(expr.value)
        return
      case 'ExternalLambda':
      case 'StringLit':
      case 'NumberLit':
      case 'Ident':
      case 'ClassRef':
      case 'StyleBlock':
      case 'MarkdownBlock':
      case 'RegexLit':
        return
    }
  }
  const visitStmt = (stmt: Stmt): void => {
    switch (stmt.kind) {
      case 'LetDecl':
      case 'DestructureLetDecl':
        visit(stmt.value)
        return
      case 'InterfaceDecl':
      case 'TypeAlias':
      case 'EnumDecl':
      case 'ExceptionDecl':
      case 'ImportDecl':
      case 'ReExportDecl':
        return
    }
  }
  const visitChild = (child: Child): void => {
    if (child !== null && typeof child === 'object') visit(child)
  }
  for (const stmt of program.body) visitStmt(stmt)
  return out
}

function isDeprecatedPositionalComponentCall(
  expr: Extract<Expr, { kind: 'CallExpr' }>,
  exceptionNames: ReadonlySet<string>
): boolean {
  if (expr.namedArgs !== undefined) return false
  if (!/^[A-Z]/.test(expr.callee)) return false
  if (exceptionNames.has(expr.callee)) return false
  return expr.args.length > 0 || expr.children !== undefined
}
