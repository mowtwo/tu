import {
  canonicalizeShapes,
  classifyTopLevel,
  generateTSWithMap,
  inferBundleParamTypes,
  lineColAt,
  parse,
  tokenize,
  type CellKind,
  type Expr,
  type Program,
  type TokenMapping,
} from '@tu-lang/compiler'
import ts from 'typescript'
import { cssService, findCssContextAt, validateCssBlocks } from './css-lsp.js'
import { findAttrAt, findTagCallAt, renderHtmlAttrDocs, renderHtmlTagDocs } from './html-lsp.js'
import { checkExceptionScope } from './exception-scope.js'
import { buildSourceMapper, lineColToOffset, mapSourceLineColToTS, mapTSRangeToSource } from './source-map.js'

export interface TuBrowserFile {
  /** Workspace-absolute path, e.g. `/types/App.tu`. */
  path: string
  source: string
}

export interface TuBrowserHover {
  contents: string
  documentation?: string
  line: number
  col: number
  length: number
}

export interface TuBrowserLocation {
  uri: string
  line: number
  col: number
  length: number
  isDefinition?: boolean
}

export interface TuBrowserCompletionItem {
  label: string
  kind: string
  sortText: string
  insertText?: string
  detail?: string
  documentation?: string
}

export interface TuBrowserDiagnostic {
  line: number
  col: number
  length: number
  severity: 'error' | 'warning' | 'info' | 'hint'
  message: string
  code: number
}

interface BrowserShadow {
  virtualPath: string
  tuPath: string
  ts: string
  tuSource: string
  tokenMappings: TokenMapping[]
  mapPos: (genLine: number, genCol: number) => { line: number; col: number }
  ast: Program
}

interface BrowserSession {
  shadows: Map<string, BrowserShadow>
  rootShadow: BrowserShadow
  service: ts.LanguageService
  files: Map<string, string>
}

interface ParsedFile {
  source: string
  filename: string
  ast: Program
}

const LIB_PATH = '/__tu_lsp__/lib.d.ts'
const RUNTIME_DTS_PATH = '/__tu_lsp__/@tu-lang/runtime/index.d.ts'
const STD_DTS_PATH = '/__tu_lsp__/@tu-lang/std/index.d.ts'

const SUPPORT_FILES = new Map<string, string>([
  [LIB_PATH, minimalLibDts()],
  [RUNTIME_DTS_PATH, runtimeDts()],
  [STD_DTS_PATH, stdDts()],
])

let cached: {
  key: string
  session: BrowserSession
} | null = null

export function hoverAtTuBrowserPosition(
  files: readonly TuBrowserFile[],
  rootPath: string,
  line: number,
  col: number
): TuBrowserHover | null {
  const root = fileSource(files, rootPath)
  if (!root) return null
  const cssHover = maybeCssHover(root, line, col)
  if (cssHover !== undefined) return cssHover
  const htmlHover = maybeHtmlHover(root, line, col)
  if (htmlHover) return htmlHover

  const session = getBrowserSession(files, rootPath)
  if (!session) return null
  const mapped = mapSourceLineColToTS(session.rootShadow.tokenMappings, root, line, col, {
    inclusiveEnd: true,
  })
  if (!mapped) return null
  const info = session.service.getQuickInfoAtPosition(session.rootShadow.virtualPath, mapped.tsOffset)
  if (!info) return null
  const rawContents = ts.displayPartsToString(info.displayParts)
  const contents = replaceAnonymousObjectTypes(
    rawContents,
    session.shadows,
    session.rootShadow.tuPath,
    mapped.tokenSrcStart,
    session.rootShadow.ast,
    root.slice(mapped.tokenSrcStart, mapped.tokenSrcEnd)
  )
  let documentation = info.documentation?.length
    ? ts.displayPartsToString(info.documentation)
    : undefined
  const expansions = expandInterfaceTypes(contents, session.shadows)
  if (expansions) documentation = documentation ? `${documentation}\n\n${expansions}` : expansions
  const lc = lineColAt(root, mapped.tokenSrcStart)
  return {
    contents,
    ...(documentation ? { documentation } : {}),
    line: lc.line - 1,
    col: lc.col - 1,
    length: Math.max(1, mapped.tokenSrcEnd - mapped.tokenSrcStart),
  }
}

export function completionsAtTuBrowserPosition(
  files: readonly TuBrowserFile[],
  rootPath: string,
  line: number,
  col: number
): TuBrowserCompletionItem[] {
  const root = fileSource(files, rootPath)
  if (!root) return []
  const cssItems = maybeCssCompletions(root, line, col)
  if (cssItems) return cssItems

  const session = getBrowserSession(files, rootPath)
  if (!session) return []
  const mapped = mapSourceLineColToTS(session.rootShadow.tokenMappings, root, line, col, {
    inclusiveEnd: true,
  })
  if (!mapped) return []
  const info = session.service.getCompletionsAtPosition(session.rootShadow.virtualPath, mapped.tsOffset, {})
  const out: TuBrowserCompletionItem[] = info?.entries.map((e) => ({
    label: e.name,
    kind: e.kind,
    sortText: e.sortText,
    ...(e.insertText ? { insertText: e.insertText } : {}),
  })) ?? []
  return out
}

export function definitionAtTuBrowserPosition(
  files: readonly TuBrowserFile[],
  rootPath: string,
  line: number,
  col: number
): TuBrowserLocation[] {
  const root = fileSource(files, rootPath)
  if (!root) return []
  const importTarget = importSourceTargetAt(root, rootPath, line, col, files)
  if (importTarget) return [{ uri: uriForPath(importTarget), line: 0, col: 0, length: 0 }]

  const session = getBrowserSession(files, rootPath)
  if (!session) return []
  const word = identifierAt(root, line, col)
  const interfaceFallback = word ? interfaceDefinitions(session, word) : []
  const mapped = mapSourceLineColToTS(session.rootShadow.tokenMappings, root, line, col, {
    inclusiveEnd: true,
  })
  if (!mapped) return dedupeLocations(interfaceFallback)
  const defs = session.service.getDefinitionAtPosition(session.rootShadow.virtualPath, mapped.tsOffset)
  if (!defs || defs.length === 0) return interfaceFallback
  const out: TuBrowserLocation[] = []
  for (const d of defs) {
    const target = session.shadows.get(d.fileName)
    if (!target) continue
    const range = mapTSRangeToSource(target.tokenMappings, target.ts, target.tuSource, d.textSpan.start, d.textSpan.length, target.mapPos)
    out.push({ uri: uriForPath(target.tuPath), line: range.line, col: range.col, length: range.length })
  }
  return out.length > 0 ? dedupeLocations(out) : dedupeLocations(interfaceFallback)
}

export function referencesAtTuBrowserPosition(
  files: readonly TuBrowserFile[],
  rootPath: string,
  line: number,
  col: number,
  includeDeclaration = true
): TuBrowserLocation[] {
  const root = fileSource(files, rootPath)
  if (!root) return []
  const session = getBrowserSession(files, rootPath)
  if (!session) return []
  const mapped = mapSourceLineColToTS(session.rootShadow.tokenMappings, root, line, col, {
    inclusiveEnd: true,
  })
  if (!mapped) return []
  const found = session.service.findReferences(session.rootShadow.virtualPath, mapped.tsOffset)
  if (!found) return []
  const out: TuBrowserLocation[] = []
  const seen = new Set<string>()
  const push = (fileName: string, start: number, length: number, isDefinition: boolean): void => {
    const target = session.shadows.get(fileName)
    if (!target) return
    const range = mapTSRangeToSource(target.tokenMappings, target.ts, target.tuSource, start, length, target.mapPos)
    const key = `${target.tuPath}:${range.line}:${range.col}:${range.length}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ uri: uriForPath(target.tuPath), line: range.line, col: range.col, length: range.length, isDefinition })
  }
  for (const sym of found) {
    if (includeDeclaration) {
      push(sym.definition.fileName, sym.definition.textSpan.start, sym.definition.textSpan.length, true)
    }
    for (const ref of sym.references) {
      const isDef =
        ref.fileName === sym.definition.fileName &&
        ref.textSpan.start === sym.definition.textSpan.start &&
        ref.textSpan.length === sym.definition.textSpan.length
      if (!includeDeclaration && isDef) continue
      push(ref.fileName, ref.textSpan.start, ref.textSpan.length, isDef)
    }
  }
  return out
}

export function diagnosticsAtTuBrowserFile(
  files: readonly TuBrowserFile[],
  rootPath: string
): TuBrowserDiagnostic[] {
  const root = fileSource(files, rootPath)
  if (!root) return []
  let session: BrowserSession | null = null
  try {
    session = getBrowserSession(files, rootPath)
  } catch {
    session = null
  }
  if (!session) {
    try {
      parse(tokenize(root, rootPath), root, rootPath)
    } catch (err) {
      return [{
        line: 0,
        col: 0,
        length: 1,
        severity: 'error',
        message: err instanceof Error ? err.message : String(err),
        code: -1,
      }]
    }
    return []
  }

  const program = ts.createProgram({
    rootNames: [session.rootShadow.virtualPath],
    options: browserCompilerOptions(),
    host: createBrowserCompilerHost(session),
  })
  const out = ts.getPreEmitDiagnostics(program)
    .filter((d) => d.file?.fileName === session.rootShadow.virtualPath)
    .map((d) => translateDiagnostic(d, session!.rootShadow))

  try {
    for (const cssDiag of validateCssBlocks(root, session.rootShadow.ast)) {
      out.push({ ...cssDiag, code: -1 })
    }
    out.push(...checkExceptionScope(session.rootShadow.ast, root))
  } catch {
    // Syntax diagnostics are already represented by the session build failure.
  }
  return out
}

function getBrowserSession(files: readonly TuBrowserFile[], rootPath: string): BrowserSession | null {
  const normalized = normalizeFiles(files)
  const root = normalizePath(rootPath)
  const key = JSON.stringify([root, [...normalized].sort(([a], [b]) => a.localeCompare(b))])
  if (cached?.key === key) return cached.session
  cached?.session.service.dispose()
  cached = null
  const rootSource = normalized.get(root)
  if (rootSource === undefined) return null
  let shadows: Map<string, BrowserShadow>
  try {
    shadows = buildBrowserShadowGraph(rootSource, root, normalized)
  } catch {
    return null
  }
  const rootShadow = shadows.get(tuPathToTs(root))
  if (!rootShadow) return null
  const session: BrowserSession = {
    shadows,
    rootShadow,
    files: normalized,
    service: ts.createLanguageService(createBrowserLsHost(shadows, rootShadow), ts.createDocumentRegistry()),
  }
  cached = { key, session }
  return session
}

function buildBrowserShadowGraph(
  rootSource: string,
  rootFilename: string,
  files: ReadonlyMap<string, string>
): Map<string, BrowserShadow> {
  const parsed = bfsParseGraph(rootSource, rootFilename, files)
  const programs = new Map<string, Program>()
  for (const [filename, file] of parsed) programs.set(filename, file.ast)
  const exportKinds = collectDirectExportKinds(parsed)
  const exportedInterfaces = collectExportedInterfaceNames(parsed)
  const inferredParamTypesByFile = inferBundleParamTypes(programs)
  const canonical = canonicalizeShapes(programs)
  const out = new Map<string, BrowserShadow>()
  for (const file of parsed.values()) {
    const importedNameKinds = buildImportedNameKinds(file, exportKinds)
    const importedInterfaceNames = buildImportedInterfaceNames(file, exportedInterfaces)
    const compiled = generateTSWithMap(file.ast, file.source, file.filename, {
      ...(importedNameKinds ? { importedNameKinds } : {}),
      ...(importedInterfaceNames ? { importedInterfaceNames } : {}),
      ...(inferredParamTypesByFile.get(file.filename)
        ? { inferredParamTypes: inferredParamTypesByFile.get(file.filename) }
        : {}),
    })
    const virtualPath = tuPathToTs(file.filename)
    out.set(virtualPath, {
      virtualPath,
      tuPath: file.filename,
      ts: compiled.code,
      tuSource: file.source,
      tokenMappings: compiled.tokenMappings,
      mapPos: buildSourceMapper(compiled.map),
      ast: file.ast,
    })
  }
  // Keep canonicalization alive for future hover parity checks. It is
  // computed here because generateTSWithMap and hover shape replacement
  // should see the same graph, even though the current browser surface
  // only needs the parsed AST.
  void canonical
  return out
}

function bfsParseGraph(
  rootSource: string,
  rootFilename: string,
  files: ReadonlyMap<string, string>
): Map<string, ParsedFile> {
  const out = new Map<string, ParsedFile>()
  const queue: Array<{ source: string; filename: string }> = [{ source: rootSource, filename: rootFilename }]
  const seen = new Set<string>()
  while (queue.length > 0) {
    const file = queue.shift()!
    if (seen.has(file.filename)) continue
    seen.add(file.filename)
    const ast = parse(tokenize(file.source, file.filename), file.source, file.filename)
    out.set(file.filename, { ...file, ast })
    for (const stmt of ast.body) {
      if (stmt.kind !== 'ImportDecl' && stmt.kind !== 'ReExportDecl') continue
      if (!stmt.source.startsWith('.') || !stmt.source.endsWith('.tu')) continue
      const target = resolvePath(dirname(file.filename), stmt.source)
      if (seen.has(target)) continue
      const source = files.get(target)
      if (source !== undefined) queue.push({ source, filename: target })
    }
  }
  return out
}

function createBrowserLsHost(
  shadows: Map<string, BrowserShadow>,
  rootShadow: BrowserShadow
): ts.LanguageServiceHost {
  const support = supportFileMap()
  return {
    getScriptFileNames: () => [rootShadow.virtualPath, ...shadows.keys(), ...support.keys()],
    getScriptVersion: () => '1',
    getScriptSnapshot: (name) => {
      const text = shadows.get(name)?.ts ?? support.get(name)
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text)
    },
    getCurrentDirectory: () => '/',
    getCompilationSettings: () => browserCompilerOptions(),
    getDefaultLibFileName: () => LIB_PATH,
    fileExists: (name) => shadows.has(name) || support.has(name),
    readFile: (name) => shadows.get(name)?.ts ?? support.get(name),
    readDirectory: () => [],
    directoryExists: (name) => name === '/' || name.startsWith('/__tu_lsp__'),
    getDirectories: () => [],
  }
}

function createBrowserCompilerHost(session: BrowserSession): ts.CompilerHost {
  const support = supportFileMap()
  const opts = browserCompilerOptions()
  return {
    getSourceFile: (name, languageVersion) => {
      const text = session.shadows.get(name)?.ts ?? support.get(name)
      return text === undefined ? undefined : ts.createSourceFile(name, text, languageVersion, true)
    },
    getDefaultLibFileName: () => LIB_PATH,
    writeFile: () => undefined,
    getCurrentDirectory: () => '/',
    getDirectories: () => [],
    fileExists: (name) => session.shadows.has(name) || support.has(name),
    readFile: (name) => session.shadows.get(name)?.ts ?? support.get(name),
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    directoryExists: (name) => name === '/' || name.startsWith('/__tu_lsp__'),
    getCompilationSettings: () => opts,
  } as ts.CompilerHost
}

function browserCompilerOptions(): ts.CompilerOptions {
  return {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    lib: [LIB_PATH],
    baseUrl: '/',
    paths: {
      '@tu-lang/runtime': [RUNTIME_DTS_PATH],
      '@tu-lang/std': [STD_DTS_PATH],
    },
  }
}

function translateDiagnostic(d: ts.Diagnostic, shadow: BrowserShadow): TuBrowserDiagnostic {
  const range = mapTSRangeToSource(
    shadow.tokenMappings,
    shadow.ts,
    shadow.tuSource,
    d.start ?? 0,
    d.length ?? 1,
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

function collectDirectExportKinds(parsed: Map<string, ParsedFile>): Map<string, Map<string, CellKind>> {
  const out = new Map<string, Map<string, CellKind>>()
  for (const [filename, file] of parsed) {
    const exports = new Map<string, CellKind>()
    for (const stmt of file.ast.body) {
      if (stmt.kind === 'LetDecl' && stmt.exported) {
        const kind = classifyTopLevel(stmt.value)
        exports.set(stmt.name, kind)
        if (stmt.default) exports.set('default', kind)
      }
    }
    out.set(filename, exports)
  }
  return out
}

function collectExportedInterfaceNames(parsed: Map<string, ParsedFile>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const [filename, file] of parsed) {
    const names = new Set<string>()
    for (const stmt of file.ast.body) {
      if (stmt.kind === 'InterfaceDecl' && stmt.exported) names.add(stmt.name)
    }
    out.set(filename, names)
  }
  return out
}

function buildImportedNameKinds(
  file: ParsedFile,
  exportKinds: Map<string, Map<string, CellKind>>
): Map<string, CellKind> | undefined {
  let result: Map<string, CellKind> | undefined
  for (const stmt of file.ast.body) {
    if (stmt.kind !== 'ImportDecl') continue
    if (!stmt.source.startsWith('.') || !stmt.source.endsWith('.tu')) continue
    const target = resolvePath(dirname(file.filename), stmt.source)
    const exports = exportKinds.get(target)
    if (!exports) continue
    for (const name of stmt.names) {
      const kind = exports.get(name)
      if (kind === undefined) continue
      result ??= new Map()
      result.set(name, kind)
    }
    if (stmt.default) {
      const kind = exports.get('default')
      if (kind !== undefined) {
        result ??= new Map()
        result.set(stmt.default, kind)
      }
    }
  }
  return result
}

function buildImportedInterfaceNames(
  file: ParsedFile,
  exportedInterfaces: Map<string, Set<string>>
): Set<string> | undefined {
  let result: Set<string> | undefined
  for (const stmt of file.ast.body) {
    if (stmt.kind !== 'ImportDecl') continue
    if (!stmt.source.startsWith('.') || !stmt.source.endsWith('.tu')) continue
    const target = resolvePath(dirname(file.filename), stmt.source)
    const names = exportedInterfaces.get(target)
    if (!names) continue
    for (const name of stmt.names) {
      if (!names.has(name)) continue
      result ??= new Set()
      result.add(name)
    }
  }
  return result
}

function maybeCssHover(source: string, line: number, col: number): TuBrowserHover | null | undefined {
  const ctx = findCssContextAt(source, line, col)
  if (!ctx) return undefined
  const hover = cssService().doHover(ctx.doc, { line: ctx.cssLine, character: ctx.cssCol }, ctx.stylesheet)
  if (!hover?.contents) return null
  const contents = Array.isArray(hover.contents)
    ? hover.contents.map((x) => typeof x === 'string' ? x : x.value).join('\n')
    : typeof hover.contents === 'string'
      ? hover.contents
      : hover.contents.value
  const lc = lineColAt(source, ctx.block.cssStart)
  return {
    contents,
    line: lc.line - 1 + (hover.range?.start.line ?? ctx.cssLine),
    col: (hover.range?.start.line ?? 0) === 0
      ? lc.col - 1 + (hover.range?.start.character ?? ctx.cssCol)
      : hover.range?.start.character ?? ctx.cssCol,
    length: Math.max(1, (hover.range?.end.character ?? ctx.cssCol + 1) - (hover.range?.start.character ?? ctx.cssCol)),
  }
}

function maybeHtmlHover(source: string, line: number, col: number): TuBrowserHover | null {
  const offset = lineColToOffset(source, line, col)
  if (offset === null) return null
  const tag = findTagCallAt(source, offset)
  if (tag) {
    const docs = renderHtmlTagDocs(tag.tag)
    if (docs) {
      const lc = lineColAt(source, tag.start)
      return { contents: docs, line: lc.line - 1, col: lc.col - 1, length: tag.end - tag.start }
    }
  }
  const attr = findAttrAt(source, offset)
  if (attr) {
    const docs = renderHtmlAttrDocs(attr.tag, attr.attr)
    if (docs) {
      const lc = lineColAt(source, attr.start)
      return { contents: docs, line: lc.line - 1, col: lc.col - 1, length: attr.end - attr.start }
    }
  }
  return null
}

function maybeCssCompletions(source: string, line: number, col: number): TuBrowserCompletionItem[] | null {
  const ctx = findCssContextAt(source, line, col)
  if (!ctx) return null
  const list = cssService().doComplete(ctx.doc, { line: ctx.cssLine, character: ctx.cssCol }, ctx.stylesheet)
  return list.items.map((it) => ({
    label: it.label,
    kind: 'property',
    sortText: it.sortText ?? '5_' + it.label,
    ...(typeof it.insertText === 'string' ? { insertText: it.insertText } : {}),
    ...(typeof it.detail === 'string' ? { detail: it.detail } : {}),
    ...(typeof it.documentation === 'string'
      ? { documentation: it.documentation }
      : it.documentation && typeof it.documentation === 'object' && 'value' in it.documentation
        ? { documentation: String(it.documentation.value) }
        : {}),
  }))
}

function expandInterfaceTypes(contents: string, shadows: ReadonlyMap<string, BrowserShadow>): string | null {
  const byName = new Map<string, string[]>()
  for (const shadow of shadows.values()) {
    for (const stmt of shadow.ast.body) {
      if (stmt.kind !== 'InterfaceDecl') continue
      byName.set(stmt.name, stmt.fields.map((f) => `  ${f.name}${f.optional ? '?' : ''}: ${f.rawType.trim()}`))
    }
  }
  const seen = new Set<string>()
  for (const m of contents.matchAll(/\b([A-Z][\w$]*)\b/g)) {
    if (byName.has(m[1]!)) seen.add(m[1]!)
  }
  if (seen.size === 0) return null
  const lines: string[] = []
  for (const name of seen) {
    lines.push(`**${name}**`)
    lines.push('```typescript')
    lines.push(`interface ${name} {`)
    for (const field of byName.get(name)!) lines.push(field)
    lines.push('}')
    lines.push('```')
  }
  return lines.join('\n')
}

function replaceAnonymousObjectTypes(
  contents: string,
  shadows: ReadonlyMap<string, BrowserShadow>,
  rootTuPath: string,
  hoverOffset: number,
  rootAst: Program,
  sourceToken: string
): string {
  const candidates = collectInterfaceShapeCandidates(shadows, rootTuPath, hoverOffset)
  if (candidates.length === 0) return contents
  let out = ''
  let last = 0
  for (const span of objectTypeSpans(contents)) {
    const key = shapeKeyFromObjectType(contents.slice(span.start + 1, span.end - 1))
    const match = key ? candidates.find((c) => c.shapeKey === key) : undefined
    if (!match) continue
    out += contents.slice(last, span.start) + match.name
    last = span.end
  }
  const replaced = last === 0 ? contents : out + contents.slice(last)
  if (replaced !== contents) return replaced
  const inferred = inferNamedObjectLetShape(rootAst, sourceToken)
  const match = inferred ? candidates.find((c) => c.shapeKey === inferred) : undefined
  return match ? contents.replace(/\bSignal\.(State|Computed)<any>/g, `Signal.$1<${match.name}>`) : contents
}

function collectInterfaceShapeCandidates(
  shadows: ReadonlyMap<string, BrowserShadow>,
  rootTuPath: string,
  hoverOffset: number
): Array<{ name: string; shapeKey: string; sourceFile: string; start: number }> {
  const out: Array<{ name: string; shapeKey: string; sourceFile: string; start: number }> = []
  for (const shadow of shadows.values()) {
    for (const stmt of shadow.ast.body) {
      if (stmt.kind !== 'InterfaceDecl') continue
      out.push({
        name: stmt.name,
        shapeKey: shapeKeyFromFields(stmt.fields.map((f) => ({
          name: f.name,
          optional: f.optional,
          type: normalizeShapeType(f.rawType),
        }))),
        sourceFile: shadow.tuPath,
        start: stmt.start,
      })
    }
  }
  return out.sort((a, b) => {
    const al = a.sourceFile === rootTuPath ? 0 : 1
    const bl = b.sourceFile === rootTuPath ? 0 : 1
    if (al !== bl) return al - bl
    return al === 0 ? Math.abs(a.start - hoverOffset) - Math.abs(b.start - hoverOffset) : a.name.localeCompare(b.name)
  })
}

function objectTypeSpans(contents: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = []
  const stack: number[] = []
  for (let i = 0; i < contents.length; i++) {
    if (contents[i] === '{') stack.push(i)
    else if (contents[i] === '}' && stack.length > 0) {
      const start = stack.pop()!
      if (stack.length === 0) spans.push({ start, end: i + 1 })
    }
  }
  return spans
}

function shapeKeyFromObjectType(body: string): string | null {
  const fields: Array<{ name: string; optional: boolean; type: string }> = []
  for (const part of body.split(/[;,]/)) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const match = /^(?:readonly\s+)?([A-Za-z_$][\w$]*|"[^"]+"|'[^']+')(\?)?\s*:\s*(.+)$/.exec(trimmed)
    if (!match) return null
    fields.push({
      name: match[1]!.replace(/^['"]|['"]$/g, ''),
      optional: match[2] === '?',
      type: normalizeShapeType(match[3]!),
    })
  }
  return fields.length > 0 ? shapeKeyFromFields(fields) : null
}

function shapeKeyFromFields(fields: ReadonlyArray<{ name: string; optional: boolean; type: string }>): string {
  return [...fields].sort((a, b) => a.name.localeCompare(b.name)).map((f) => `${f.name}:${f.optional ? '?' : ''}${f.type}`).join('|')
}

function normalizeShapeType(raw: string): string {
  const t = raw.trim().replace(/\s+/g, ' ')
  if (/^(['"]).*\1$/.test(t)) return 'string'
  if (/^-?\d+(?:\.\d+)?$/.test(t)) return 'number'
  if (t === 'true' || t === 'false') return 'boolean'
  return t.replace(/\s*\|\s*/g, '|').replace(/\s*&\s*/g, '&').replace(/\s*<\s*/g, '<').replace(/\s*>\s*/g, '>').replace(/\s*,\s*/g, ',')
}

function inferNamedObjectLetShape(ast: Program, name: string): string | null {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return null
  for (const stmt of ast.body) {
    if (stmt.kind !== 'LetDecl' || stmt.name !== name || stmt.type !== undefined || stmt.value.kind !== 'ObjectLit') continue
    const fields: Array<{ name: string; optional: boolean; type: string }> = []
    for (const member of stmt.value.properties) {
      if (member.kind === 'ObjectSpread' || member.keyKind === 'computed') return null
      fields.push({ name: member.key, optional: false, type: normalizeShapeType(inferExprShapeType(member.value)) })
    }
    return fields.length > 0 ? shapeKeyFromFields(fields) : null
  }
  return null
}

function inferExprShapeType(expr: Expr): string {
  switch (expr.kind) {
    case 'StringLit':
    case 'TemplateLit':
      return 'string'
    case 'NumberLit':
      return 'number'
    case 'Ident':
      if (expr.name === 'true' || expr.name === 'false') return 'boolean'
      if (expr.name === 'null') return 'null'
      return expr.name
    default:
      return 'unknown'
  }
}

function interfaceDefinitions(session: BrowserSession, word: string): TuBrowserLocation[] {
  const out: TuBrowserLocation[] = []
  for (const shadow of session.shadows.values()) {
    for (const stmt of shadow.ast.body) {
      if (stmt.kind !== 'InterfaceDecl' || stmt.name !== word) continue
      const lc = lineColAt(shadow.tuSource, stmt.nameStart)
      out.push({ uri: uriForPath(shadow.tuPath), line: lc.line - 1, col: lc.col - 1, length: stmt.nameEnd - stmt.nameStart })
    }
  }
  return out
}

function dedupeLocations(locations: TuBrowserLocation[]): TuBrowserLocation[] {
  const out: TuBrowserLocation[] = []
  const seen = new Set<string>()
  for (const loc of locations) {
    const key = `${loc.uri}:${loc.line}:${loc.col}:${loc.length}:${loc.isDefinition ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(loc)
  }
  return out
}

function importSourceTargetAt(
  source: string,
  filename: string,
  line: number,
  col: number,
  files: readonly TuBrowserFile[]
): string | null {
  const cursor = lineColToOffset(source, line, col)
  if (cursor === null) return null
  let ast: Program
  try {
    ast = parse(tokenize(source, filename), source, filename)
  } catch {
    return null
  }
  const all = normalizeFiles(files)
  for (const stmt of ast.body) {
    if (stmt.kind !== 'ImportDecl' && stmt.kind !== 'ReExportDecl') continue
    const quoted = findQuotedSubstring(source, stmt.start, stmt.end, stmt.source)
    if (!quoted || cursor < quoted.openIdx || cursor > quoted.closeIdx) continue
    if (!stmt.source.startsWith('.') || !stmt.source.endsWith('.tu')) return null
    const target = resolvePath(dirname(filename), stmt.source)
    return all.has(target) ? target : null
  }
  return null
}

function findQuotedSubstring(source: string, start: number, end: number, target: string): { openIdx: number; closeIdx: number } | null {
  for (const quote of ['"', "'"]) {
    const needle = quote + target + quote
    const idx = source.indexOf(needle, start)
    if (idx >= 0 && idx + needle.length <= end) return { openIdx: idx, closeIdx: idx + needle.length - 1 }
  }
  return null
}

function identifierAt(source: string, line: number, col: number): string | null {
  const text = source.split('\n')[line]
  if (text === undefined || col < 0 || col > text.length) return null
  const isPart = (ch: string) => /^[A-Za-z_$0-9]$/.test(ch)
  let start = col
  let end = col
  while (start > 0 && isPart(text[start - 1] ?? '')) start--
  while (end < text.length && isPart(text[end] ?? '')) end++
  if (start === end) return null
  const word = text.slice(start, end)
  return /^\d/.test(word) ? null : word
}

function normalizeFiles(files: readonly TuBrowserFile[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const file of files) out.set(normalizePath(file.path), file.source)
  return out
}

function fileSource(files: readonly TuBrowserFile[], rootPath: string): string | null {
  return normalizeFiles(files).get(normalizePath(rootPath)) ?? null
}

function supportFileMap(): Map<string, string> {
  return SUPPORT_FILES
}

function tuPathToTs(path: string): string {
  return path.endsWith('.tu') ? path.slice(0, -3) + '.ts' : path + '.ts'
}

function normalizePath(path: string): string {
  let p = path.replace(/\\/g, '/')
  if (p.startsWith('tu:')) {
    try {
      p = new URL(p).pathname
    } catch {
      p = p.replace(/^tu:\/*/, '/')
    }
  }
  if (!p.startsWith('/')) p = '/' + p
  const parts: string[] = []
  for (const part of p.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return '/' + parts.join('/')
}

function dirname(path: string): string {
  const p = normalizePath(path)
  const idx = p.lastIndexOf('/')
  return idx <= 0 ? '/' : p.slice(0, idx)
}

function resolvePath(base: string, relative: string): string {
  return normalizePath(base + '/' + relative)
}

function uriForPath(path: string): string {
  return 'tu://' + normalizePath(path)
}

function minimalLibDts(): string {
  return `
interface IteratorResult<T> { done?: boolean; value: T }
interface Iterator<T> { next(): IteratorResult<T> }
interface Iterable<T> { [Symbol.iterator](): Iterator<T> }
interface SymbolConstructor { readonly iterator: symbol }
declare var Symbol: SymbolConstructor
interface Array<T> extends Iterable<T> { length: number; [n: number]: T; map<U>(fn: (value: T, index: number) => U): U[]; filter(fn: (value: T, index: number) => boolean): T[]; find(fn: (value: T, index: number) => boolean): T | undefined; slice(start?: number, end?: number): T[]; includes(value: T): boolean; push(...items: T[]): number; [Symbol.iterator](): Iterator<T>; }
interface ReadonlyArray<T> extends Iterable<T> { readonly length: number; readonly [n: number]: T; [Symbol.iterator](): Iterator<T>; }
interface String { length: number; includes(search: string): boolean; trim(): string; toLowerCase(): string; toUpperCase(): string; slice(start?: number, end?: number): string; }
interface Number {}
interface Boolean {}
interface RegExp { test(s: string): boolean }
interface Promise<T> { then<TResult>(onfulfilled?: (value: T) => TResult | Promise<TResult>): Promise<TResult>; catch<TResult>(onrejected?: (reason: unknown) => TResult | Promise<TResult>): Promise<T | TResult>; }
interface PromiseConstructor { new <T>(executor: (resolve: (value: T | Promise<T>) => void, reject: (reason?: unknown) => void) => void): Promise<T>; resolve<T>(value: T): Promise<T>; }
declare var Promise: PromiseConstructor
interface Error { name: string; message: string; stack?: string }
interface ErrorConstructor { new(message?: string): Error; captureStackTrace?: (target: object, constructorOpt?: Function) => void }
declare var Error: ErrorConstructor
interface Function {}
interface ObjectConstructor { keys(o: object): string[]; defineProperty(o: object, p: string, attributes: object): object; freeze<T>(o: T): Readonly<T>; entries<T>(o: { [key: string]: T }): [string, T][] }
declare var Object: ObjectConstructor
interface JSON { parse(text: string): unknown; stringify(value: unknown): string }
declare var JSON: JSON
interface Event { target: EventTarget | null }
interface EventTarget {}
interface HTMLElement extends EventTarget { value?: string }
declare function String(value: unknown): string
declare function Number(value: unknown): number
declare function Boolean(value: unknown): boolean
type Readonly<T> = { readonly [P in keyof T]: T[P] }
type Record<K extends keyof any, T> = { [P in K]: T }
type Parameters<T extends (...args: any) => any> = T extends (...args: infer P) => any ? P : never
type Extract<T, U> = T extends U ? T : never
type Exclude<T, U> = T extends U ? never : T
type NonNullable<T> = T extends null | undefined ? never : T
`.trim()
}

function runtimeDts(): string {
  return `
declare module '@tu-lang/runtime' {
  export interface VNode { tag: string; props: Record<string, unknown>; children: Child[]; html?: string }
  export type Child = VNode | string | number | null | undefined | Child[] | Promise<Child>
  export function h(tag: string, props?: Record<string, unknown>, children?: Child[], html?: string): VNode
  export namespace Signal {
    class State<T> { constructor(value: T); get(): T; set(value: T): void }
    class Computed<T> { constructor(fn: () => T); get(): T }
  }
}
`.trim()
}

function stdDts(): string {
  return `
declare module '@tu-lang/std' {
  export interface TypeDescriptor {
    kind: string
    name: string
    fields?: ReadonlyArray<{ name: string; type: TypeDescriptor; optional: boolean }>
  }
  export interface TypedDescriptor<T> extends TypeDescriptor {
    readonly __tu_type?: T
  }
  export class TypeMismatchError extends Error {
    expected: TypeDescriptor
    actual: unknown
  }
  export const type: {
    Number: TypeDescriptor
    String: TypeDescriptor
    Boolean: TypeDescriptor
    Object: TypeDescriptor
    Any: TypeDescriptor
    Never: TypeDescriptor
    Error: TypeDescriptor
    RegExp: TypeDescriptor
    Array(inner: TypeDescriptor): TypeDescriptor
    Optional(inner: TypeDescriptor): TypeDescriptor
    struct(name: string, fields: ReadonlyArray<{ name: string; type: TypeDescriptor; optional?: boolean }>): TypeDescriptor
    native(name: string, check: (v: unknown) => boolean): TypeDescriptor
    tag<T extends object>(descriptor: TypeDescriptor, value: T): T
    of(value: unknown): TypeDescriptor
    is<T>(value: unknown, descriptor: TypedDescriptor<T>): value is T
    is(value: unknown, descriptor: TypeDescriptor): boolean
    as<T>(value: unknown, descriptor: TypeDescriptor, cast?: (value: unknown) => unknown): T
    tryFrom<T>(value: unknown, descriptor: TypeDescriptor, cast?: (value: unknown) => unknown): { ok: true; value: T } | { ok: false; error: TypeMismatchError }
  }
  export type { TypeDescriptor as __tu_TypeDescriptor, TypedDescriptor as __tu_TypedDescriptor }
}
`.trim()
}
