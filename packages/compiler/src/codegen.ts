import type {
  ArrayLit,
  AssignExpr,
  BinaryExpr,
  BinaryOp,
  Block,
  CallExpr,
  Child,
  ClassRef,
  Expr,
  ForExpr,
  ExceptionDecl,
  IfExpr,
  InterfaceDecl,
  Lambda,
  LetDecl,
  LocalLet,
  MarkdownBlock,
  MemberExpr,
  MethodCallExpr,
  ObjectLit,
  Program,
  Prop,
  Stmt,
  ExternalLambda,
  StyleBlock,
  TagCall,
  TemplateLit,
  TryExpr,
} from './ast.js'
import { lineColAt } from './diagnostics.js'
import MarkdownIt from 'markdown-it'

// Singleton markdown-it — CommonMark + linkify + typographer. Code-
// block highlighting is **pluggable**: callers (e.g. @tu-lang/tu-shu)
// inject a highlighter via `setMarkdownHighlight` before compiling
// pages, so the same Shiki grammar set drives both the SSG and the
// site that consumes it. Without an injected highlighter, code
// blocks fall back to plain `<pre><code class="language-X">`.
let mdInstance: MarkdownIt | null = null
let mdHighlighter: ((code: string, lang: string) => string) | null = null

/**
 * Install a custom code-block highlighter for `markdown { … }` body
 * rendering. The function receives raw code text + the fence's `lang`
 * tag (e.g. `'tu'`, `'ts'`), and must return a complete HTML string
 * (typically `<pre class="shiki…"><code>…</code></pre>`). Throwing or
 * returning empty string falls back to markdown-it's default.
 *
 * Calling this resets the singleton markdown-it instance so the new
 * highlighter applies on the next compile.
 */
export function setMarkdownHighlight(
  fn: ((code: string, lang: string) => string) | null
): void {
  mdHighlighter = fn
  mdInstance = null
}

function getMd(): MarkdownIt {
  if (!mdInstance) {
    const opts: ConstructorParameters<typeof MarkdownIt>[0] = {
      html: true,
      linkify: true,
      typographer: true,
    }
    if (mdHighlighter) {
      const hi = mdHighlighter
      opts.highlight = (code, lang) => {
        try {
          return hi(code, lang) ?? ''
        } catch {
          return ''
        }
      }
    }
    mdInstance = new MarkdownIt(opts)
  }
  return mdInstance
}

/**
 * Auto-injected import at the head of every compiled module.
 *
 * In TS-emit mode we ALSO bring in the type-only exports `Child` and
 * `VNode` so user annotations like `(children: VNode[])` or
 * `(items: Child[])` resolve without requiring the user to write the
 * import themselves. JS-emit drops the type-only members (they're not
 * legal ESM at runtime).
 */
function runtimeImportLine(tsMode: boolean): string {
  if (tsMode) return `import { h, Signal, type Child, type VNode } from '@tu-lang/runtime'`
  return `import { h, Signal } from '@tu-lang/runtime'`
}

/**
 * Auto-import for the M8 type metadata API. Emitted at the top of any
 * compiled module that contains an `interface` declaration (Phase 2). User
 * `.tu` code can then write `type.struct(…)` / `type.of(v)` / `type.is(v, I)`
 * via the standard `type.X` member access without writing the import
 * themselves — same auto-import treatment `h` and `Signal` already get.
 */
function typeImportLine(tsMode: boolean): string {
  if (tsMode)
    return `import { type, type TypeDescriptor as __tu_TypeDescriptor } from '@tu-lang/std'`
  return `import { type } from '@tu-lang/std'`
}

// ── M8 Phase 3 — anonymous-interface synthesis + shape interning ────
//
// Every untyped `let X = { … }` triggers compiler-side synthesis of an
// anonymous interface descriptor at module-level. The let's value is
// then wrapped in `type.tag(__tu_anon_N, …)` so `type.of(X)` recovers
// the synthesized shape instead of falling back to the runtime's
// own structural-walk. Same-shape literals share one descriptor via
// structural-hash interning — so the cost is paid once per unique
// shape, not once per literal.

interface AnonSynthResult {
  /** Per-LetDecl: the anon descriptor name to wrap the value in (if any). */
  letToAnon: Map<LetDecl, string>
  /** Pre-rendered `const __tu_anon_N = type.struct(…)` lines, ordered. */
  anonDecls: string[]
}

/**
 * M8 Phase 6c — rewrite anon-interface decls to alias the canonical
 * descriptor instead of constructing a fresh one. The `synth.anonDecls`
 * lines (`const __tu_anon_N = type.struct(…)`) are replaced in-place
 * with `const __tu_anon_N = T_HASH` references; tag-injection sites
 * stay unchanged since they target the local name.
 *
 * The canonical map keys are letDecl-name-based (`__anon_<letName>`),
 * not the `__tu_anon_N` indexed names — so we resolve the let-name →
 * anon-index mapping via the synth result and rewrite by index.
 */
function rewriteAnonDeclsForCanonical(
  synth: { letToAnon: Map<LetDecl, string>; anonDecls: string[] },
  canonicalNames: ReadonlyMap<string, string>
): void {
  // Build anonName → canonicalName by walking letToAnon entries:
  // canonical map is keyed by `__anon_<letName>`; letToAnon maps
  // LetDecl→anonName.
  const anonToCanonical = new Map<string, string>()
  for (const [decl, anonName] of synth.letToAnon) {
    const canon = canonicalNames.get(`__anon_${decl.name}`)
    if (canon) anonToCanonical.set(anonName, canon)
  }
  for (let i = 0; i < synth.anonDecls.length; i++) {
    const line = synth.anonDecls[i]!
    const m = line.match(/^const (__tu_anon_\d+) = /)
    if (!m) continue
    const anonName = m[1]!
    const canon = anonToCanonical.get(anonName)
    if (canon) {
      synth.anonDecls[i] = `const ${anonName} = __tu_canon_${canon}`
    }
  }
}

function synthesizeAnonInterfaces(
  program: Program,
  declaredInterfaceNames: Set<string>
): AnonSynthResult {
  const internCache = new Map<string, string>()
  const letToAnon = new Map<LetDecl, string>()
  const anonDecls: string[] = []
  let counter = 0

  for (const stmt of program.body) {
    if (stmt.kind !== 'LetDecl') continue
    if (stmt.type !== undefined) continue // typed lets — Phase 2.5 path
    if (stmt.value.kind !== 'ObjectLit') continue

    // Build per-prop descriptor expressions. Spread members force a
    // soft skip (Phase 3d will resolve them by tracing the source's
    // descriptor); for now an untyped `let X = {...a, extra}` gets no
    // anon synthesis.
    const fields: { name: string; descExpr: string }[] = []
    let canSynth = true
    for (const member of stmt.value.properties) {
      if (member.kind === 'ObjectSpread') {
        canSynth = false
        break
      }
      if (member.keyKind === 'computed') {
        canSynth = false
        break
      }
      const descExpr = exprToDescExpr(member.value, declaredInterfaceNames)
      fields.push({ name: member.key, descExpr })
    }
    if (!canSynth) continue
    if (fields.length === 0) continue // empty object — no shape to capture

    // Hash for interning — sort by name so order-of-keys variations
    // share descriptors. (Tu emits keys in source order, but two
    // equivalent shapes shouldn't allocate twice.)
    const sorted = [...fields].sort((a, b) => a.name.localeCompare(b.name))
    const hash = sorted.map((f) => `${f.name}:${f.descExpr}`).join('|')

    let anonName = internCache.get(hash)
    if (anonName === undefined) {
      anonName = `__tu_anon_${counter++}`
      internCache.set(hash, anonName)
      const fieldsJs = fields
        .map(
          (f) => `{ name: ${JSON.stringify(f.name)}, type: ${f.descExpr} }`
        )
        .join(', ')
      anonDecls.push(`const ${anonName} = type.struct("__anon", [${fieldsJs}])`)
    }
    letToAnon.set(stmt, anonName)
  }

  return { letToAnon, anonDecls }
}

/**
 * Map a Tu expression's static shape to the JS expression that builds
 * its runtime descriptor. Used inside `synthesizeAnonInterfaces` to
 * walk an ObjectLit and infer per-prop types.
 *
 * Conservative: anything we can't statically classify falls back to
 * `type.Object`, which matches any object — sound but lossy. Idents
 * resolve to either a known interface (if declared in the same module)
 * or the fallback. Phase 3c will widen this to imported interfaces.
 */
function exprToDescExpr(e: Expr, knownInterfaces: Set<string>): string {
  switch (e.kind) {
    case 'StringLit':
    case 'TemplateLit':
      return 'type.String'
    case 'NumberLit':
      return 'type.Number'
    case 'RegexLit':
      return 'type.RegExp'
    case 'Lambda':
      return 'type.Function'
    case 'Ident': {
      const n = e.name
      if (n === 'true' || n === 'false') return 'type.Boolean'
      if (n === 'null' || n === 'undefined') return 'type.Null'
      if (knownInterfaces.has(n)) return n
      return 'type.Object'
    }
    case 'ArrayLit': {
      if (e.elements.length === 0) return 'type.Array(type.Object)'
      // Sample the first element. Mixed-element arrays fall back to
      // the first element's type — same trade tsc makes for inference.
      return `type.Array(${exprToDescExpr(e.elements[0]!, knownInterfaces)})`
    }
    case 'ObjectLit': {
      // Inline nested struct (no separate hoist for the inner one;
      // the outer descriptor inlines it). Spread members → fallback.
      const fields: string[] = []
      for (const m of e.properties) {
        if (m.kind === 'ObjectSpread') return 'type.Object'
        if (m.keyKind === 'computed') return 'type.Object'
        fields.push(
          `{ name: ${JSON.stringify(m.key)}, type: ${exprToDescExpr(m.value, knownInterfaces)} }`
        )
      }
      return `type.struct("__anon", [${fields.join(', ')}])`
    }
    default:
      return 'type.Object'
  }
}

/**
 * Render the TS type text for an Exception's optional `props` argument
 * — `{ customAttr?: string; foo: number }`. Used by `emitExceptionDecl`
 * when emitting the factory function signature in TS mode.
 */
function renderPropsTypeText(fields: ReadonlyArray<{ name: string; rawType: string; optional: boolean }>): string {
  if (fields.length === 0) return '{}'
  const parts = fields.map((f) => {
    const opt = f.optional ? '?' : ''
    return `${f.name}${opt}: ${f.rawType.trim()}`
  })
  return `{ ${parts.join('; ')} }`
}

/**
 * Translate a Tu type-expression text slice to the JS expression that
 * builds its runtime descriptor. Used by `interface` codegen to populate
 * `type.struct(…, [{ name, type: <THIS> }])` per field.
 *
 * Supported (M8 Phase 2):
 *   - Primitives: `number`, `string`, `boolean`, `null`, `undefined`,
 *     `bigint`, `symbol`, `void`, `any`, `unknown`, `never`.
 *   - Functions: any `(…) => …` shape → `type.Function`.
 *   - Arrays: `T[]`, `Array<T>`, and `ReadonlyArray<T>` → `type.Array(<T>)`.
 *   - Nullable union: `T | null` → `type.Optional(<T>)`. The reverse
 *     `null | T` is also recognized.
 *   - Bare identifier: assumed to be a user-declared `interface` (or one
 *     of the built-in JS-type descriptors exposed via `type.X` —
 *     `type.Promise`, `type.Map`, etc., handled by aliasing in the
 *     descriptor lookup).
 *
 * Anything more exotic (full unions, generics other than the array
 * sugars, intersection types, conditional types, mapped types) falls
 * back to `type.Object` — sound (matches any object) but lossy. M9
 * generics + unions tighten this.
 */
function tuTypeToDescriptorExpr(
  raw: string,
  typeAliases?: ReadonlyMap<string, string>,
  runtimeDescriptorNames?: ReadonlySet<string>,
  visited?: Set<string>
): string {
  const t = raw.trim()
  if (t.length === 0) return 'type.Object'
  // String-literal: `"foo"` → `type.String` (for union members like
  // `"a" | "b" | "c"` after recursion). Keeps the descriptor close to
  // the runtime shape without needing a real union descriptor yet.
  if (/^"[^"]*"$/.test(t) || /^'[^']*'$/.test(t)) return 'type.String'
  // Numeric-literal: `42` → `type.Number`.
  if (/^-?\d/.test(t) && !isNaN(Number(t))) return 'type.Number'
  // Boolean-literal: `true` / `false` → `type.Boolean`.
  if (t === 'true' || t === 'false') return 'type.Boolean'
  // Function types — any `(…) => …` shape.
  if (/=>/.test(t) && /^\s*\(/.test(t)) return 'type.Function'
  // Nullable: `T | null` (or `null | T`). Strip the null branch and
  // recurse on the other side.
  const orParts = splitTopLevel(t, '|')
  if (orParts.length >= 2) {
    const trimmed = orParts.map((s) => s.trim())
    // 2-part unions with a null/undefined arm → Optional<T>.
    if (trimmed.length === 2) {
      const [a, b] = trimmed
      if (a === 'null' || a === 'undefined') {
        return `type.Optional(${tuTypeToDescriptorExpr(b!, typeAliases, runtimeDescriptorNames, visited)})`
      }
      if (b === 'null' || b === 'undefined') {
        return `type.Optional(${tuTypeToDescriptorExpr(a!, typeAliases, runtimeDescriptorNames, visited)})`
      }
    }
    // Multi-arm union: if every arm reduces to the SAME descriptor (e.g.
    // `"a" | "b" | "c"` → all `type.String`), pick that. Otherwise fall
    // back to Object until M9 ships a real union descriptor.
    const armDescs = trimmed.map((s) => tuTypeToDescriptorExpr(s, typeAliases, runtimeDescriptorNames, visited))
    const first = armDescs[0]!
    if (armDescs.every((d) => d === first)) return first
    return 'type.Object'
  }
  // Arrays: `T[]`
  if (t.endsWith('[]')) {
    const inner = t.slice(0, -2)
    return `type.Array(${tuTypeToDescriptorExpr(inner, typeAliases, runtimeDescriptorNames, visited)})`
  }
  // `Array<T>` / `ReadonlyArray<T>` sugar.
  const arrM = t.match(/^(?:Readonly)?Array\s*<\s*([\s\S]+)\s*>\s*$/)
  if (arrM) {
    return `type.Array(${tuTypeToDescriptorExpr(arrM[1]!, typeAliases, runtimeDescriptorNames, visited)})`
  }
  // Primitives.
  switch (t) {
    case 'number':
      return 'type.Number'
    case 'string':
      return 'type.String'
    case 'boolean':
      return 'type.Boolean'
    case 'bigint':
      return 'type.BigInt'
    case 'symbol':
      return 'type.Symbol'
    case 'null':
    case 'undefined':
    case 'void':
      return 'type.Null'
    case 'any':
    case 'unknown':
      return 'type.Any'
    case 'never':
      return 'type.Never'
  }
  // Bare identifier — could be an interface (runtime descriptor const), a
  // type alias (TS-only — must inline its body), or a built-in.
  // Identifier-or-namespaced-identifier shape (allow `type.Promise` etc.).
  if (/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(t)) {
    if (typeAliases?.has(t)) {
      const seen = visited ?? new Set<string>()
      if (seen.has(t)) return 'type.Object' // self-referential alias guard
      seen.add(t)
      return tuTypeToDescriptorExpr(typeAliases.get(t)!, typeAliases, runtimeDescriptorNames, seen)
    }
    const typeOnlyDescriptor = typeOnlyRuntimeDescriptor(t)
    if (typeOnlyDescriptor) return typeOnlyDescriptor
    const builtinDescriptor = builtinRuntimeDescriptor(t)
    if (builtinDescriptor) return builtinDescriptor
    if (runtimeDescriptorNames?.has(t)) return t
    if (t.startsWith('type.')) return t
    return 'type.Object'
  }
  // Anything else — soundly fall back to `type.Object` (matches any
  // non-null object). User can wrap fancy shapes in their own struct.
  return 'type.Object'
}

function builtinRuntimeDescriptor(name: string): string | null {
  switch (name) {
    case 'Date':
      return 'type.Date'
    case 'Promise':
      return 'type.Promise'
    case 'Map':
      return 'type.Map'
    case 'Set':
      return 'type.Set'
    case 'WeakMap':
      return 'type.WeakMap'
    case 'WeakSet':
      return 'type.WeakSet'
    case 'Error':
      return 'type.Error'
    case 'RegExp':
      return 'type.RegExp'
    case 'AbortController':
      return 'type.AbortController'
    case 'Temporal.Instant':
    case 'Instant':
      return 'type.Instant'
    case 'Temporal.ZonedDateTime':
    case 'ZonedDateTime':
      return 'type.ZonedDateTime'
    case 'Temporal.PlainDate':
    case 'PlainDate':
      return 'type.PlainDate'
    case 'Temporal.PlainTime':
    case 'PlainTime':
      return 'type.PlainTime'
    case 'Temporal.PlainDateTime':
    case 'PlainDateTime':
      return 'type.PlainDateTime'
    case 'Temporal.Duration':
    case 'Duration':
      return 'type.Duration'
  }
  return null
}

function typeOnlyRuntimeDescriptor(name: string): string | null {
  switch (name) {
    // `Child` and `VNode` are auto-imported as TS-only names from
    // @tu-lang/runtime in TS emit. They have no JS binding, so runtime
    // descriptors must not reference them directly.
    case 'Child':
      return 'type.Any'
    case 'VNode':
      return 'type.Object'
    // DOM platform types are likewise type-only aliases from @tu-lang/dom.
    // If a user puts one in an interface field, keep the descriptor broad
    // instead of emitting a bare erased type alias.
    case 'Element':
    case 'HTMLElement':
    case 'HTMLInputElement':
    case 'HTMLButtonElement':
    case 'HTMLAnchorElement':
    case 'HTMLImageElement':
    case 'HTMLFormElement':
    case 'HTMLTextAreaElement':
    case 'HTMLSelectElement':
    case 'HTMLOptionElement':
    case 'HTMLDivElement':
    case 'HTMLSpanElement':
    case 'HTMLLabelElement':
    case 'HTMLIFrameElement':
    case 'HTMLCanvasElement':
    case 'HTMLVideoElement':
    case 'HTMLAudioElement':
    case 'HTMLTableElement':
    case 'HTMLTableRowElement':
    case 'HTMLTableCellElement':
    case 'Node':
    case 'Text':
    case 'Document':
    case 'Window':
    case 'EventTarget':
    case 'Event':
    case 'UIEvent':
    case 'MouseEvent':
    case 'KeyboardEvent':
    case 'InputEvent':
    case 'PointerEvent':
    case 'TouchEvent':
    case 'WheelEvent':
    case 'FocusEvent':
    case 'DragEvent':
    case 'ClipboardEvent':
    case 'CustomEvent':
    case 'EventListener':
    case 'EventListenerObject':
    case 'EventListenerOrEventListenerObject':
    case 'AddEventListenerOptions':
    case 'RequestInit':
    case 'Response':
    case 'Headers':
    case 'FormData':
    case 'URLSearchParams':
    case 'AbortSignal':
      return 'type.Object'
  }
  return null
}

/**
 * Split `s` on `sep` at depth-0 only — `<>`, `[]`, `{}`, `()` are tracked.
 * Used by `tuTypeToDescriptorExpr` to detect top-level union splits without
 * tripping on `Array<A | B>` etc.
 */
function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0
  let last = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (c === '<' || c === '[' || c === '{' || c === '(') depth++
    else if (c === '>' || c === ']' || c === '}' || c === ')') depth--
    else if (depth === 0 && c === sep && s[i - 1] !== sep && s[i + 1] !== sep) {
      out.push(s.slice(last, i))
      last = i + 1
    }
  }
  out.push(s.slice(last))
  return out
}

export interface SourceMapV3 {
  version: 3
  file?: string
  sources: string[]
  sourcesContent: string[]
  names: string[]
  mappings: string
}

/**
 * A finer-grained mapping than `StmtMapping`: ties a span of generated bytes
 * to a span of source bytes. Codegen records one of these per emitted leaf
 * token (identifiers, literals, etc.) so the LSP can squiggle the offending
 * token instead of the whole `let` header.
 *
 * Spans are byte ranges; `srcEnd` is exclusive. The LSP's diagnostic-range
 * mapping consumes this list directly (it doesn't go through V3 VLQ encoding,
 * since V3 segments don't carry an explicit source-end).
 */
export interface TokenMapping {
  /** Byte offset of the span's first character in the generated code. */
  jsStart: number
  /** Byte offset after the span's last character in the generated code. */
  jsEnd: number
  /** Byte offset of the span's first character in the `.tu` source. */
  srcStart: number
  /** Byte offset after the span's last character in the `.tu` source. */
  srcEnd: number
}

/**
 * Top-level binding kinds — drives whether an identifier read becomes
 * `name.get()` or stays as a plain reference.
 */
export type CellKind = 'state' | 'computed' | 'function'

/** Tu `==` / `!=` map to JS strict equality to avoid coercion surprises.
 *  Other operators (logical, nullish, arithmetic, relational) pass
 *  through verbatim — they have identical semantics in JS. */
const BINARY_OP_JS: Record<BinaryOp, string> = {
  '+': '+', '-': '-', '*': '*', '**': '**', '/': '/', '%': '%',
  '&': '&', '|': '|', '^': '^', '<<': '<<', '>>': '>>',
  '==': '===', '!=': '!==',
  '<': '<', '<=': '<=', '>': '>', '>=': '>=',
  '||': '||', '&&': '&&', '??': '??',
}

/** Per-component scoping state. Populated for any top-level `let X = (…) => { … }`
 * whose body contains at least one ClassRef. The hash is the suffix appended
 * to every declared class name in both markup and style block, so the markup
 * `.foo` reference resolves to the same hashed string as the style block's
 * `.foo` selector. */
interface ScopeCtx {
  hash: string
  declared: Set<string>
  classTypeName: string
  scoped: boolean
}

interface StmtMapping {
  /** Byte offset of the statement's first character in the generated JS. */
  jsOffset: number
  /** Byte offset of the statement's `let` keyword in the source. */
  srcOffset: number
}

interface BuildResult {
  code: string
  stmtMappings: StmtMapping[]
  tokenMappings: TokenMapping[]
}

export type InferredParamTypes = Map<Lambda, Map<number, string>>
interface InferredObjectShape {
  children: Map<string, InferredObjectShape>
}

/**
 * Per-emit options that the rest of the toolchain (LSP, CLI, vite plugin)
 * uses to give codegen extra context it can't derive from a single source
 * file.
 */
export interface CodegenOptions {
  /**
   * Per-imported-name classification. The compiler defaults to `'function'`
   * for any name brought in by `import { X } from "./M.tu"` because, looking
   * at the importing source alone, it can't tell what kind `X` was declared
   * as in the exporting module. Callers who DO know (the LSP's shadow graph,
   * the CLI's BFS, the vite plugin's resolver) pass the map here so reads of
   * imported state / computed cells emit `X.get()` instead of `X` — fixing
   * the M2.1 reactivity bug.
   */
  importedNameKinds?: ReadonlyMap<string, CellKind>
  /**
   * Names imported from other `.tu` files that are declared there as
   * `interface X { … }` (so `X` carries a runtime descriptor const).
   * Phase 3c hook (M8): when present, typed-let sites with annotation
   * `: X` get the `type.tag(X, …)` wrapper, even though `X` itself
   * isn't declared in this module. Set by the LSP's shadow-graph
   * builder + the CLI / vite plugin once they walk imports. Without
   * this set, codegen conservatively skips tag injection for imported
   * names — sound but lossy.
   */
  importedInterfaceNames?: ReadonlySet<string>
  /**
   * M8 Phase 6b/6c — cross-module canonical-descriptor rewrite.
   *
   * When set, every interface declaration AND every anonymous-shape let
   * in this file gets rewritten to import its descriptor from a shared
   * canonical module instead of declaring it locally. The map keys are
   * the original names as they appear in this file (e.g. `User`,
   * `__anon_p`), and the values are the canonical export names in the
   * shared module (e.g. `T_0_a4f2b8c1`).
   *
   * `canonicalImportPath` is the module specifier the imports use —
   * typically a relative path to the generated `__tu_types.generated.ts`
   * the build tool emits alongside the per-file outputs.
   *
   * Both fields are populated by the orchestrator (`compileBundle()`,
   * the LSP's shadow-graph + canonicalize pre-pass, the CLI / vite
   * plugin's bundle emit). The standalone `compile()` / `compileToTS()`
   * paths leave them undefined and emit the local-descriptor form
   * unchanged.
   */
  canonicalNamesForFile?: ReadonlyMap<string, string>
  canonicalImportPath?: string
  /**
   * Extra parameter inference supplied by a graph-aware caller. Standalone
   * codegen can infer same-file callsites on its own; bundle/LSP callers can
   * add cross-file callsite evidence keyed by the actual Lambda nodes parsed
   * for this file.
   */
  inferredParamTypes?: InferredParamTypes
}

function buildBody(program: Program, tsMode: boolean, opts?: CodegenOptions): BuildResult {
  const cells = analyzeProgram(program, opts?.importedNameKinds)
  const scopes = analyzeScopedComponents(program)
  // Collect every top-level type-alias name so the Codegen can skip the
  // auto-`${Name}Props` interface emit when the user has hand-written a
  // type alias of the same name (which would otherwise collide with TS
  // diagnostic "Duplicate identifier 'XProps'"). Type aliases are
  // erased in JS mode but the dedup is cheap to compute either way.
  const declaredTypeNames = new Set<string>()
  const declaredInterfaceNames = new Set<string>()
  // Type-alias bodies are needed for runtime descriptor resolution: a
  // field typed `BadgeVariant` (where `type BadgeVariant = "a" | "b"`)
  // must inline the alias body to `type.String` — the alias name has no
  // runtime symbol because TS-only `type X = …` is erased in JS-emit.
  const typeAliasBodies = new Map<string, string>()
  for (const stmt of program.body) {
    if (stmt.kind === 'TypeAlias') {
      declaredTypeNames.add(stmt.name)
      typeAliasBodies.set(stmt.name, stmt.type)
    }
    if (stmt.kind === 'InterfaceDecl') {
      declaredInterfaceNames.add(stmt.name)
      // An interface also occupies the type namespace from the user's
      // perspective — track it under declaredTypeNames so the M3.9 auto-
      // generated `${Name}Props` interface skips on collision (the
      // user's hand-written interface always wins).
      declaredTypeNames.add(stmt.name)
    }
  }
  // Phase 3c (M8): merge cross-`.tu` imported interface names so typed-let
  // sites with imported annotations also get the `type.tag(I, …)` wrapper.
  // The LSP / CLI / vite plugin populates this from shadow-graph; without
  // it we fall back to the conservative "locally-declared only" behavior.
  if (opts?.importedInterfaceNames) {
    for (const name of opts.importedInterfaceNames) {
      declaredInterfaceNames.add(name)
    }
  }
  // M8 Phase 3 — pre-pass to synthesize anonymous-interface descriptors
  // for untyped `let X = { … }` sites. Each ObjectLit-initialized untyped
  // let gets a runtime descriptor matching its inferred shape; same shapes
  // share via structural-hash interning so `let a = { x: 1 }` and
  // `let b = { x: 2 }` reuse one descriptor.
  const synth = synthesizeAnonInterfaces(program, declaredInterfaceNames)
  // M8 Phase 6c — when the bundle orchestrator passes per-file canonical
  // names, the anon decls are rewritten to reference the canonical
  // descriptor from the shared module instead of declaring locally.
  if (opts?.canonicalNamesForFile) {
    rewriteAnonDeclsForCanonical(synth, opts.canonicalNamesForFile)
  }
  const inferredParamTypes = inferTopLevelParamTypes(program, opts?.inferredParamTypes)
  const cg = new Codegen(
    cells,
    scopes,
    tsMode,
    declaredTypeNames,
    declaredInterfaceNames,
    synth.letToAnon,
    opts?.canonicalNamesForFile,
    typeAliasBodies,
    inferredParamTypes
  )
  cg.write(`${runtimeImportLine(tsMode)}\n`)
  // Auto-import the M8 type API when this module:
  // (a) declares an `interface` (compiles to `type.struct(…)`), or
  // (b) declares an `Exception` (compiles to `type.native(…)`), or
  // (c) has a typed `let X: I = { … }` site where `I` is a LOCALLY-
  //     declared interface — those get wrapped in `type.tag(I, …)`, or
  // (d) has any anonymous-interface synthesis (Phase 3) — those need
  //     `type.struct` + `type.tag` both at module level.
  // Cross-module imports we conservatively skip in Phase 2.5; Phase 3c
  // (LSP-driven) will classify imported names too.
  const needsTypeImport =
    synth.anonDecls.length > 0 ||
    program.body.some(
      (s) =>
        s.kind === 'InterfaceDecl' ||
        s.kind === 'ExceptionDecl' ||
        (s.kind === 'LetDecl' &&
          s.type !== undefined &&
          /^[A-Z]\w*$/.test(s.type.trim()) &&
          s.value.kind === 'ObjectLit' &&
          declaredInterfaceNames.has(s.type.trim()))
    )
  // Skip the auto-import if the user already wrote `import { type }
  // from "@tu-lang/std"` explicitly — duplicate `type` bindings
  // collide at module load.
  const hasExplicitTypeImport = program.body.some(
    (s) =>
      s.kind === 'ImportDecl' &&
      s.source === '@tu-lang/std' &&
      s.names.includes('type')
  )
  if (needsTypeImport && !hasExplicitTypeImport)
    cg.write(`${typeImportLine(tsMode)}\n`)
  // M8 Phase 6c — when canonical mode is on, also import the
  // canonical descriptors this file uses from the shared module.
  // Imports are aliased through `__tu_canon_` prefix so a file
  // declaring `interface User` (canonical also `User`) doesn't
  // collide with its own re-export const.
  if (opts?.canonicalNamesForFile && opts.canonicalImportPath) {
    const usedCanonical = new Set<string>(opts.canonicalNamesForFile.values())
    if (usedCanonical.size > 0) {
      const aliases = [...usedCanonical]
        .sort()
        .map((n) => `${n} as __tu_canon_${n}`)
        .join(', ')
      cg.write(
        `import { ${aliases} } from ${JSON.stringify(opts.canonicalImportPath)}\n`
      )
    }
  }
  cg.write('\n')
  if (tsMode && scopes.size > 0) {
    cg.write('type __TuClassValue<C extends string> = string | number | null | undefined | false | __TuClassValue<C>[] | { [K in C]?: unknown }\n')
    cg.write('const __tu_class = <C extends string>(value: __TuClassValue<C>) => value\n')
    for (const [, ctx] of [...scopes].sort(([a], [b]) => a.localeCompare(b))) {
      if (declaredTypeNames.has(ctx.classTypeName)) continue
      const members =
        ctx.declared.size === 0
          ? 'never'
          : [...ctx.declared].sort().map((name) => JSON.stringify(name)).join(' | ')
      cg.write(`type ${ctx.classTypeName} = ${members}\n`)
    }
    cg.write('\n')
  }
  // Anonymous-interface descriptors hoisted before user code so `type.tag`
  // sites can reference them.
  for (const line of synth.anonDecls) {
    cg.write(line + '\n')
  }
  if (synth.anonDecls.length > 0) cg.write('\n')
  for (const stmt of program.body) {
    // Type aliases erase entirely in JS mode — they have no runtime presence.
    if (stmt.kind === 'TypeAlias' && !tsMode) continue
    cg.recordStmtMapping(stmt.start)
    cg.emitStmt(stmt)
    cg.write('\n')
  }
  return cg.finish()
}

export function generate(program: Program, opts?: CodegenOptions): string {
  return buildBody(program, false, opts).code
}

/**
 * Generate JS with a V3 source map. The returned code carries an inline
 * `//# sourceMappingURL=` data-URL footer; the same map is also returned
 * separately for tooling that consumes it programmatically. The richer
 * per-token mapping list is exposed alongside for the LSP / type-checker.
 */
export function generateWithMap(
  program: Program,
  source: string,
  filename?: string,
  opts?: CodegenOptions
): { code: string; map: SourceMapV3; tokenMappings: TokenMapping[] } {
  const result = buildBody(program, false, opts)
  const sourceName = filename ?? 'input.tu'
  const map = buildV3Map(result.stmtMappings, result.tokenMappings, result.code, source, sourceName)
  const inline = base64Encode(JSON.stringify(map))
  const footer = `//# sourceMappingURL=data:application/json;charset=utf-8;base64,${inline}\n`
  return { code: result.code + footer, map, tokenMappings: result.tokenMappings }
}

/**
 * Generate TypeScript source with a V3 source map. Same semantics as
 * `generateWithMap` but lambda parameter type annotations from the Tu source
 * are preserved (`(name: string)` instead of `(name)`), so tsserver can infer
 * the rest.
 */
export function generateTSWithMap(
  program: Program,
  source: string,
  filename?: string,
  opts?: CodegenOptions
): { code: string; map: SourceMapV3; tokenMappings: TokenMapping[] } {
  const result = buildBody(program, true, opts)
  const sourceName = filename ?? 'input.tu'
  const map = buildV3Map(result.stmtMappings, result.tokenMappings, result.code, source, sourceName)
  const inline = base64Encode(JSON.stringify(map))
  const footer = `//# sourceMappingURL=data:application/json;charset=utf-8;base64,${inline}\n`
  return { code: result.code + footer, map, tokenMappings: result.tokenMappings }
}

function analyzeProgram(
  program: Program,
  importedNameKinds?: ReadonlyMap<string, CellKind>
): Map<string, CellKind> {
  const cells = new Map<string, CellKind>()
  for (const stmt of program.body) {
    if (stmt.kind === 'LetDecl') {
      cells.set(stmt.name, classifyValue(stmt.value))
    }
    // Imported names: prefer the caller-provided kind (state / computed /
    // function); otherwise default to 'function' for the standalone-compile
    // path that has no graph view.
    if (stmt.kind === 'ImportDecl') {
      for (const name of stmt.names) {
        cells.set(name, importedNameKinds?.get(name) ?? 'function')
      }
    }
  }
  return cells
}

/** Public re-export so callers (LSP, CLI) can build the importedNameKinds map. */
export function classifyTopLevel(value: Expr): CellKind {
  return classifyValue(value)
}

/**
 * Empty-array literal at the cell-init site? Used by codegen to widen
 * `Signal.State` / `Signal.Computed` to `<unknown[]>` so a later assign
 * of a real array isn't blocked by tsserver's `never[]` inference of the
 * literal.
 */
function isEmptyArray(expr: Expr | undefined): boolean {
  return expr?.kind === 'ArrayLit' && expr.elements.length === 0
}

function classifyValue(expr: Expr): CellKind {
  if (expr.kind === 'Lambda') return 'function'
  if (expr.kind === 'ExternalLambda') return 'function'
  if (expr.kind === 'CallExpr' && expr.callee === 'computed') return 'computed'
  return 'state'
}

/**
 * Public — for the LSP's ClassRef completion. Returns a map from
 * component name to the set of class names declared in that component's
 * `style { … }` block. Mirrors the internal `analyzeScopedComponents`
 * but drops the per-component hash (which IDE consumers don't need).
 */
export function getScopedClassMap(program: Program): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const [name, ctx] of analyzeScopedComponents(program)) {
    out.set(name, ctx.declared)
  }
  return out
}

function analyzeScopedComponents(program: Program): Map<string, ScopeCtx> {
  const out = new Map<string, ScopeCtx>()
  for (const stmt of program.body) {
    if (stmt.kind !== 'LetDecl') continue
    if (stmt.value.kind !== 'Lambda') continue
    const styleBodies: string[] = []
    collectStyleBlockBodies(stmt.value.body, styleBodies)
    const refs = new Set<string>()
    collectClassRefs(stmt.value.body, refs)
    if (refs.size === 0 && styleBodies.length === 0) continue
    const declared = new Set<string>()
    for (const css of styleBodies) {
      for (const c of findCssClasses(css)) declared.add(c)
    }
    const hash = fnv1a6(`${stmt.name} ${styleBodies.join(' ')}`)
    out.set(stmt.name, {
      hash,
      declared,
      classTypeName: `ClassesOf_${stmt.name}`,
      scoped: refs.size > 0,
    })
  }
  return out
}

function inferTopLevelParamTypes(
  program: Program,
  extraCallsiteParamTypes?: ReadonlyMap<Lambda, ReadonlyMap<number, string>>
): InferredParamTypes {
  const functions = new Map<string, Lambda>()
  const valueTypes = new Map<string, string>()
  for (const stmt of program.body) {
    if (stmt.kind !== 'LetDecl') continue
    if (stmt.value.kind === 'Lambda') functions.set(stmt.name, stmt.value)
    if (stmt.type !== undefined) {
      valueTypes.set(stmt.name, stmt.type.trim())
      continue
    }
    if (stmt.value.kind === 'Lambda') continue
    const inferredValueType = inferExprTsType(stmt.value, valueTypes)
    if (inferredValueType) valueTypes.set(stmt.name, inferredValueType)
  }

  const inferred: InferredParamTypes = new Map()
  collectCallsiteParamTypes(program, functions, valueTypes, inferred)
  mergeInferredParamTypeMaps(inferred, extraCallsiteParamTypes)

  const returnTypes = inferTopLevelFunctionReturnTypes(functions, inferred, valueTypes)
  for (const stmt of program.body) {
    if (stmt.kind !== 'LetDecl') continue
    if (stmt.type !== undefined || stmt.value.kind === 'Lambda') continue
    const inferredValueType = inferExprTsType(stmt.value, valueTypes, returnTypes)
    if (inferredValueType) valueTypes.set(stmt.name, inferredValueType)
  }

  collectCallsiteParamTypes(program, functions, valueTypes, inferred)
  mergeInferredParamTypeMaps(inferred, extraCallsiteParamTypes)

  for (const lambda of functions.values()) {
    const bodyShapes = inferBodyFirstUseParamTypes(lambda)
    if (bodyShapes.size === 0) continue
    let byParam = inferred.get(lambda)
    for (const [idx, typeText] of bodyShapes) {
      const p = lambda.params[idx]
      if (!p || p.type !== undefined || p.destructureFields) continue
      if (byParam?.has(idx)) continue
      if (!byParam) {
        byParam = new Map()
        inferred.set(lambda, byParam)
      }
      byParam.set(idx, typeText)
    }
  }
  return inferred
}

export function inferBundleParamTypes(programs: ReadonlyMap<string, Program>): Map<string, InferredParamTypes> {
  const exportedFunctions = collectExportedFunctions(programs)

  const out = new Map<string, InferredParamTypes>()
  for (const [filename, program] of programs) {
    const valueTypes = collectTopLevelValueTypes(program)
    const importedFunctions = collectImportedFunctions(filename, program, programs, exportedFunctions)
    if (importedFunctions.size === 0) continue

    for (const stmt of program.body) {
      collectCallsFromStmt(stmt, (call) => {
        const target = importedFunctions.get(call.callee)
        if (!target) return
        if (call.namedArgs && call.namedArgs.length > 0) return
        const lambda = target.lambda
        for (let i = 0; i < call.args.length && i < lambda.params.length; i++) {
          const p = lambda.params[i]!
          if (p.type !== undefined || p.destructureFields) continue
          const t = inferExprTsType(call.args[i]!, valueTypes)
          if (!t) continue
          let byFile = out.get(target.filename)
          if (!byFile) {
            byFile = new Map()
            out.set(target.filename, byFile)
          }
          let byParam = byFile.get(lambda)
          if (!byParam) {
            byParam = new Map()
            byFile.set(lambda, byParam)
          }
          byParam.set(i, mergeInferredTypes(byParam.get(i), t))
        }
      })
    }
  }

  return out
}

type ExportedFunctionTarget = { filename: string; lambda: Lambda }

function collectExportedFunctions(programs: ReadonlyMap<string, Program>): Map<string, Map<string, ExportedFunctionTarget>> {
  const out = new Map<string, Map<string, ExportedFunctionTarget>>()
  for (const [filename, program] of programs) {
    const exports = new Map<string, ExportedFunctionTarget>()
    for (const stmt of program.body) {
      if (stmt.kind !== 'LetDecl') continue
      if (!stmt.exported || stmt.value.kind !== 'Lambda') continue
      exports.set(stmt.name, { filename, lambda: stmt.value })
    }
    out.set(filename, exports)
  }

  let changed = true
  while (changed) {
    changed = false
    for (const [filename, program] of programs) {
      const exports = out.get(filename)!
      for (const stmt of program.body) {
        if (stmt.kind !== 'ReExportDecl') continue
        const targetFilename = resolveTuImport(filename, stmt.source, programs)
        if (!targetFilename) continue
        const targetExports = out.get(targetFilename)
        if (!targetExports) continue
        for (const name of stmt.names) {
          if (exports.has(name)) continue
          const target = targetExports.get(name)
          if (!target) continue
          exports.set(name, target)
          changed = true
        }
      }
    }
  }

  return out
}

function collectTopLevelValueTypes(program: Program): Map<string, string> {
  const valueTypes = new Map<string, string>()
  for (const stmt of program.body) {
    if (stmt.kind !== 'LetDecl') continue
    if (stmt.type !== undefined) {
      valueTypes.set(stmt.name, stmt.type.trim())
      continue
    }
    if (stmt.value.kind === 'Lambda') continue
    const inferredValueType = inferExprTsType(stmt.value, valueTypes)
    if (inferredValueType) valueTypes.set(stmt.name, inferredValueType)
  }
  return valueTypes
}

function collectImportedFunctions(
  filename: string,
  program: Program,
  programs: ReadonlyMap<string, Program>,
  exportedFunctions: ReadonlyMap<string, ReadonlyMap<string, ExportedFunctionTarget>>
): Map<string, ExportedFunctionTarget> {
  const out = new Map<string, ExportedFunctionTarget>()
  for (const stmt of program.body) {
    if (stmt.kind !== 'ImportDecl') continue
    const targetFilename = resolveTuImport(filename, stmt.source, programs)
    if (!targetFilename) continue
    const exports = exportedFunctions.get(targetFilename)
    if (!exports) continue
    for (const name of stmt.names) {
      const target = exports.get(name)
      if (target) out.set(name, target)
    }
  }
  return out
}

function resolveTuImport(
  fromFilename: string,
  source: string,
  programs: ReadonlyMap<string, Program>
): string | undefined {
  if (!source.endsWith('.tu')) return undefined
  const candidates = source.startsWith('.')
    ? [normalizeTuPath(`${dirnameOfTuPath(fromFilename)}/${source}`), normalizeTuPath(source)]
    : [normalizeTuPath(source)]
  for (const candidate of candidates) {
    if (programs.has(candidate)) return candidate
  }
  return undefined
}

function dirnameOfTuPath(filename: string): string {
  const normalized = normalizeTuPath(filename)
  const idx = normalized.lastIndexOf('/')
  return idx >= 0 ? normalized.slice(0, idx) : '.'
}

function normalizeTuPath(path: string): string {
  const absolute = path.startsWith('/')
  const parts: string[] = []
  for (const raw of path.split('/')) {
    if (!raw || raw === '.') continue
    if (raw === '..') {
      parts.pop()
      continue
    }
    parts.push(raw)
  }
  return `${absolute ? '/' : ''}${parts.join('/')}`
}

function mergeInferredParamTypeMaps(
  base: InferredParamTypes,
  extra: ReadonlyMap<Lambda, ReadonlyMap<number, string>> | undefined
): InferredParamTypes {
  if (!extra) return base
  for (const [lambda, byParamExtra] of extra) {
    let byParam = base.get(lambda)
    if (!byParam) {
      byParam = new Map()
      base.set(lambda, byParam)
    }
    for (const [idx, typeText] of byParamExtra) {
      byParam.set(idx, mergeInferredTypes(byParam.get(idx), typeText))
    }
  }
  return base
}

function collectCallsiteParamTypes(
  program: Program,
  functions: ReadonlyMap<string, Lambda>,
  valueTypes: ReadonlyMap<string, string>,
  inferred: InferredParamTypes
): void {
  for (const stmt of program.body) {
    collectCallsFromStmt(stmt, (call) => {
      const lambda = functions.get(call.callee)
      if (!lambda) return
      if (call.namedArgs && call.namedArgs.length > 0) return
      for (let i = 0; i < call.args.length && i < lambda.params.length; i++) {
        const p = lambda.params[i]!
        if (p.type !== undefined || p.destructureFields) continue
        let byParam = inferred.get(lambda)
        const t = inferExprTsType(call.args[i]!, valueTypes)
        if (!t) continue
        if (!byParam) {
          byParam = new Map()
          inferred.set(lambda, byParam)
        }
        byParam.set(i, mergeInferredTypes(byParam.get(i), t))
      }
    })
  }
}

function inferTopLevelFunctionReturnTypes(
  functions: ReadonlyMap<string, Lambda>,
  inferred: InferredParamTypes,
  valueTypes: ReadonlyMap<string, string>
): Map<string, string> {
  const returnTypes = new Map<string, string>()
  for (const [name, lambda] of functions) {
    if (lambda.returnType) {
      returnTypes.set(name, lambda.returnType.trim())
      continue
    }
    const localTypes = new Map(valueTypes)
    for (let i = 0; i < lambda.params.length; i++) {
      const p = lambda.params[i]!
      if (p.destructureFields) continue
      const typeText = p.type?.trim() || inferred.get(lambda)?.get(i)
      if (typeText) localTypes.set(p.name, typeText)
    }
    const returnType = inferExprTsType(lambda.body, localTypes)
    if (!returnType) continue
    returnTypes.set(name, returnType)
  }
  return returnTypes
}

function mergeInferredTypes(existing: string | undefined, candidate: string): string {
  if (!existing || existing === candidate) return candidate
  const parts: string[] = []
  const seen = new Set<string>()
  for (const part of [...splitTopLevel(existing, '|'), ...splitTopLevel(candidate, '|')]) {
    const trimmed = part.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    parts.push(trimmed)
  }
  if (parts.length === 0) return candidate
  if (parts.length === 1) return parts[0]!
  return parts.join(' | ')
}

function inferBodyFirstUseParamTypes(lambda: Lambda): Map<number, string> {
  const paramNames = new Map<string, number>()
  for (let i = 0; i < lambda.params.length; i++) {
    const p = lambda.params[i]!
    if (p.type !== undefined || p.destructureFields) continue
    paramNames.set(p.name, i)
  }
  if (paramNames.size === 0) return new Map()

  const shapesByParam = new Map<number, InferredObjectShape>()
  collectParamMemberReads(lambda.body, paramNames, shapesByParam, new Set())

  const out = new Map<number, string>()
  for (const [idx, shape] of shapesByParam) {
    if (shape.children.size === 0) continue
    out.set(idx, renderInferredObjectShape(shape))
  }
  const bodyUseTypes = new Map<number, string>()
  collectParamBodyUseTypes(lambda.body, paramNames, bodyUseTypes, new Set())
  for (const [idx, typeText] of bodyUseTypes) {
    out.set(idx, mergeInferredTypes(out.get(idx), typeText))
  }
  return out
}

function emptyInferredObjectShape(): InferredObjectShape {
  return { children: new Map() }
}

function addInferredPath(root: InferredObjectShape, path: string[]): void {
  let cursor = root
  for (const field of path) {
    let child = cursor.children.get(field)
    if (!child) {
      child = emptyInferredObjectShape()
      cursor.children.set(field, child)
    }
    cursor = child
  }
}

function renderInferredObjectShape(shape: InferredObjectShape): string {
  const fields = [...shape.children.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([field, child]) => {
      const value = child.children.size > 0 ? renderInferredObjectShape(child) : 'unknown'
      return `${renderObjectTypeKey(field)}: ${value}`
    })
  return `{ ${fields.join('; ')} }`
}

function memberPathFromParam(expr: Expr, paramNames: ReadonlyMap<string, number>): { idx: number; path: string[] } | undefined {
  const path: string[] = []
  let cursor: Expr = expr
  while (cursor.kind === 'MemberExpr') {
    path.unshift(cursor.property)
    cursor = cursor.object
  }
  if (cursor.kind !== 'Ident') return undefined
  const idx = paramNames.get(cursor.name)
  if (idx === undefined) return undefined
  if (path.length === 0) return undefined
  return { idx, path }
}

function collectParamMemberReads(
  expr: Expr,
  paramNames: ReadonlyMap<string, number>,
  shapesByParam: Map<number, InferredObjectShape>,
  shadowed: ReadonlySet<string>
): void {
  const recordMember = (member: MemberExpr): void => {
    const found = memberPathFromParam(member, paramNames)
    if (!found) return
    let root: Expr = member
    while (root.kind === 'MemberExpr') root = root.object
    if (root.kind === 'Ident' && shadowed.has(root.name)) return
    let shape = shapesByParam.get(found.idx)
    if (!shape) {
      shape = emptyInferredObjectShape()
      shapesByParam.set(found.idx, shape)
    }
    addInferredPath(shape, found.path)
  }

  switch (expr.kind) {
    case 'MemberExpr':
      recordMember(expr)
      collectParamMemberReads(expr.object, paramNames, shapesByParam, shadowed)
      return
    case 'MethodCallExpr':
      collectParamMemberReads(expr.object, paramNames, shapesByParam, shadowed)
      for (const arg of expr.args) collectParamMemberReads(arg, paramNames, shapesByParam, shadowed)
      return
    case 'Lambda': {
      const nextShadowed = new Set(shadowed)
      for (const p of expr.params) {
        if (p.destructureFields) {
          for (const f of p.destructureFields) nextShadowed.add(f)
        } else {
          nextShadowed.add(p.name)
        }
      }
      collectParamMemberReads(expr.body, paramNames, shapesByParam, nextShadowed)
      return
    }
    case 'Block': {
      const nextShadowed = new Set(shadowed)
      for (const item of expr.body) {
        if (item.kind === 'LocalLet') {
          collectParamMemberReads(item.value, paramNames, shapesByParam, nextShadowed)
          if (item.destructureFields) {
            for (const f of item.destructureFields) nextShadowed.add(f)
          } else {
            nextShadowed.add(item.name)
          }
        } else {
          collectParamMemberReads(item, paramNames, shapesByParam, nextShadowed)
        }
      }
      return
    }
    case 'CallExpr':
      for (const arg of expr.args) collectParamMemberReads(arg, paramNames, shapesByParam, shadowed)
      for (const arg of expr.namedArgs ?? []) collectParamMemberReads(arg.value, paramNames, shapesByParam, shadowed)
      for (const child of expr.children ?? []) collectParamMemberReadsFromChild(child, paramNames, shapesByParam, shadowed)
      return
    case 'TagCall':
      for (const prop of expr.props) collectParamMemberReads(prop.value, paramNames, shapesByParam, shadowed)
      for (const child of expr.children) collectParamMemberReadsFromChild(child, paramNames, shapesByParam, shadowed)
      return
    case 'ArrayLit':
      for (const item of expr.elements) collectParamMemberReads(item, paramNames, shapesByParam, shadowed)
      return
    case 'ObjectLit':
      for (const prop of expr.properties) {
        if (prop.kind === 'ObjectSpread') collectParamMemberReads(prop.arg, paramNames, shapesByParam, shadowed)
        else {
          if (prop.computedKey) collectParamMemberReads(prop.computedKey, paramNames, shapesByParam, shadowed)
          collectParamMemberReads(prop.value, paramNames, shapesByParam, shadowed)
        }
      }
      return
    case 'IndexExpr':
      collectParamMemberReads(expr.object, paramNames, shapesByParam, shadowed)
      collectParamMemberReads(expr.index, paramNames, shapesByParam, shadowed)
      return
    case 'MemberAssignExpr':
      collectParamMemberReads(expr.target, paramNames, shapesByParam, shadowed)
      collectParamMemberReads(expr.value, paramNames, shapesByParam, shadowed)
      return
    case 'InvokeExpr':
      collectParamMemberReads(expr.callee, paramNames, shapesByParam, shadowed)
      for (const arg of expr.args) collectParamMemberReads(arg, paramNames, shapesByParam, shadowed)
      return
    case 'AssignExpr':
      collectParamMemberReads(expr.value, paramNames, shapesByParam, shadowed)
      return
    case 'BinaryExpr':
      collectParamMemberReads(expr.left, paramNames, shapesByParam, shadowed)
      collectParamMemberReads(expr.right, paramNames, shapesByParam, shadowed)
      return
    case 'UnaryExpr':
    case 'NonNullAssertExpr':
    case 'AsExpr':
    case 'AwaitExpr':
      collectParamMemberReads(expr.arg, paramNames, shapesByParam, shadowed)
      return
    case 'IfExpr':
      collectParamMemberReads(expr.cond, paramNames, shapesByParam, shadowed)
      collectParamMemberReads(expr.then, paramNames, shapesByParam, shadowed)
      if (expr.else) collectParamMemberReads(expr.else, paramNames, shapesByParam, shadowed)
      return
    case 'ForExpr': {
      collectParamMemberReads(expr.iter, paramNames, shapesByParam, shadowed)
      const nextShadowed = new Set(shadowed)
      nextShadowed.add(expr.item)
      collectParamMemberReads(expr.body, paramNames, shapesByParam, nextShadowed)
      return
    }
    case 'TryExpr':
      collectParamMemberReads(expr.body, paramNames, shapesByParam, shadowed)
      if (expr.catchClause) {
        const nextShadowed = new Set(shadowed)
        if (expr.catchClause.param) nextShadowed.add(expr.catchClause.param)
        collectParamMemberReads(expr.catchClause.body, paramNames, shapesByParam, nextShadowed)
      }
      if (expr.finallyClause) collectParamMemberReads(expr.finallyClause, paramNames, shapesByParam, shadowed)
      return
    case 'TernaryExpr':
      collectParamMemberReads(expr.cond, paramNames, shapesByParam, shadowed)
      collectParamMemberReads(expr.then, paramNames, shapesByParam, shadowed)
      collectParamMemberReads(expr.else, paramNames, shapesByParam, shadowed)
      return
    case 'NewExpr':
      collectParamMemberReads(expr.arg, paramNames, shapesByParam, shadowed)
      return
    case 'UpdateExpr':
      collectParamMemberReads(expr.arg, paramNames, shapesByParam, shadowed)
      return
    case 'TemplateLit':
      for (const part of expr.expressions) collectParamMemberReads(part, paramNames, shapesByParam, shadowed)
      return
    case 'SpreadElement':
      collectParamMemberReads(expr.arg, paramNames, shapesByParam, shadowed)
      return
    case 'ThrowExpr':
      collectParamMemberReads(expr.arg, paramNames, shapesByParam, shadowed)
      return
    case 'ReturnExpr':
      if (expr.value) collectParamMemberReads(expr.value, paramNames, shapesByParam, shadowed)
      return
    case 'ImportExpr':
      collectParamMemberReads(expr.arg, paramNames, shapesByParam, shadowed)
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

function collectParamMemberReadsFromChild(
  child: Child,
  paramNames: ReadonlyMap<string, number>,
  shapesByParam: Map<number, InferredObjectShape>,
  shadowed: ReadonlySet<string>
): void {
  if (child === null || typeof child !== 'object') return
  collectParamMemberReads(child, paramNames, shapesByParam, shadowed)
}

function collectParamBodyUseTypes(
  expr: Expr,
  paramNames: ReadonlyMap<string, number>,
  typesByParam: Map<number, string>,
  shadowed: ReadonlySet<string>
): void {
  const recordIdent = (candidate: Expr, typeText: string): void => {
    if (candidate.kind !== 'Ident') return
    if (shadowed.has(candidate.name)) return
    const idx = paramNames.get(candidate.name)
    if (idx === undefined) return
    typesByParam.set(idx, mergeInferredTypes(typesByParam.get(idx), typeText))
  }

  switch (expr.kind) {
    case 'Ident':
    case 'StringLit':
    case 'NumberLit':
    case 'ClassRef':
    case 'StyleBlock':
    case 'MarkdownBlock':
    case 'RegexLit':
    case 'ExternalLambda':
      return
    case 'MemberExpr':
      collectParamBodyUseTypes(expr.object, paramNames, typesByParam, shadowed)
      return
    case 'MethodCallExpr':
      collectParamBodyUseTypes(expr.object, paramNames, typesByParam, shadowed)
      for (const arg of expr.args) collectParamBodyUseTypes(arg, paramNames, typesByParam, shadowed)
      return
    case 'Lambda': {
      const nextShadowed = new Set(shadowed)
      for (const p of expr.params) {
        if (p.destructureFields) {
          for (const f of p.destructureFields) nextShadowed.add(f)
        } else {
          nextShadowed.add(p.name)
        }
      }
      collectParamBodyUseTypes(expr.body, paramNames, typesByParam, nextShadowed)
      return
    }
    case 'Block': {
      const nextShadowed = new Set(shadowed)
      for (const item of expr.body) {
        if (item.kind === 'LocalLet') {
          collectParamBodyUseTypes(item.value, paramNames, typesByParam, nextShadowed)
          if (item.destructureFields) {
            for (const f of item.destructureFields) nextShadowed.add(f)
          } else {
            nextShadowed.add(item.name)
          }
        } else {
          collectParamBodyUseTypes(item, paramNames, typesByParam, nextShadowed)
        }
      }
      return
    }
    case 'BinaryExpr': {
      if (expr.op === '-' || expr.op === '*' || expr.op === '**' || expr.op === '/' || expr.op === '%' || expr.op === '&' || expr.op === '|' || expr.op === '^' || expr.op === '<<' || expr.op === '>>') {
        recordIdent(expr.left, 'number')
        recordIdent(expr.right, 'number')
      }
      if (expr.op === '+') {
        if (literalComparableType(expr.right) === 'number') recordIdent(expr.left, 'number')
        if (literalComparableType(expr.left) === 'number') recordIdent(expr.right, 'number')
      }
      if (expr.op === '<' || expr.op === '<=' || expr.op === '>' || expr.op === '>=') {
        recordIdent(expr.left, literalComparableType(expr.right) ?? 'number')
        recordIdent(expr.right, literalComparableType(expr.left) ?? 'number')
      }
      if (expr.op === '==' || expr.op === '!=') {
        const rightType = literalComparableType(expr.right)
        const leftType = literalComparableType(expr.left)
        if (rightType) recordIdent(expr.left, rightType)
        if (leftType) recordIdent(expr.right, leftType)
      }
      collectParamBodyUseTypes(expr.left, paramNames, typesByParam, shadowed)
      collectParamBodyUseTypes(expr.right, paramNames, typesByParam, shadowed)
      return
    }
    case 'UnaryExpr':
      if (expr.op === '!') recordIdent(expr.arg, 'boolean')
      if (expr.op === '~') recordIdent(expr.arg, 'number')
      if (expr.op === '-' || expr.op === '+') recordIdent(expr.arg, 'number')
      collectParamBodyUseTypes(expr.arg, paramNames, typesByParam, shadowed)
      return
    case 'IndexExpr':
      recordIdent(expr.object, 'unknown[]')
      collectParamBodyUseTypes(expr.object, paramNames, typesByParam, shadowed)
      collectParamBodyUseTypes(expr.index, paramNames, typesByParam, shadowed)
      return
    case 'SpreadElement':
      recordIdent(expr.arg, 'unknown[]')
      collectParamBodyUseTypes(expr.arg, paramNames, typesByParam, shadowed)
      return
    case 'ForExpr': {
      recordIdent(expr.iter, 'unknown[]')
      collectParamBodyUseTypes(expr.iter, paramNames, typesByParam, shadowed)
      const nextShadowed = new Set(shadowed)
      nextShadowed.add(expr.item)
      collectParamBodyUseTypes(expr.body, paramNames, typesByParam, nextShadowed)
      return
    }
    case 'CallExpr':
      for (const arg of expr.args) collectParamBodyUseTypes(arg, paramNames, typesByParam, shadowed)
      for (const arg of expr.namedArgs ?? []) collectParamBodyUseTypes(arg.value, paramNames, typesByParam, shadowed)
      for (const child of expr.children ?? []) collectParamBodyUseTypesFromChild(child, paramNames, typesByParam, shadowed)
      return
    case 'TagCall':
      for (const prop of expr.props) collectParamBodyUseTypes(prop.value, paramNames, typesByParam, shadowed)
      for (const child of expr.children) collectParamBodyUseTypesFromChild(child, paramNames, typesByParam, shadowed)
      return
    case 'ArrayLit':
      for (const item of expr.elements) collectParamBodyUseTypes(item, paramNames, typesByParam, shadowed)
      return
    case 'ObjectLit':
      for (const prop of expr.properties) {
        if (prop.kind === 'ObjectSpread') collectParamBodyUseTypes(prop.arg, paramNames, typesByParam, shadowed)
        else {
          if (prop.computedKey) collectParamBodyUseTypes(prop.computedKey, paramNames, typesByParam, shadowed)
          collectParamBodyUseTypes(prop.value, paramNames, typesByParam, shadowed)
        }
      }
      return
    case 'MemberAssignExpr':
      collectParamBodyUseTypes(expr.target, paramNames, typesByParam, shadowed)
      collectParamBodyUseTypes(expr.value, paramNames, typesByParam, shadowed)
      return
    case 'InvokeExpr':
      collectParamBodyUseTypes(expr.callee, paramNames, typesByParam, shadowed)
      for (const arg of expr.args) collectParamBodyUseTypes(arg, paramNames, typesByParam, shadowed)
      return
    case 'AssignExpr':
      collectParamBodyUseTypes(expr.value, paramNames, typesByParam, shadowed)
      return
    case 'NonNullAssertExpr':
    case 'AsExpr':
    case 'AwaitExpr':
      collectParamBodyUseTypes(expr.arg, paramNames, typesByParam, shadowed)
      return
    case 'IfExpr':
      collectParamBodyUseTypes(expr.cond, paramNames, typesByParam, shadowed)
      collectParamBodyUseTypes(expr.then, paramNames, typesByParam, shadowed)
      if (expr.else) collectParamBodyUseTypes(expr.else, paramNames, typesByParam, shadowed)
      return
    case 'TryExpr':
      collectParamBodyUseTypes(expr.body, paramNames, typesByParam, shadowed)
      if (expr.catchClause) {
        const nextShadowed = new Set(shadowed)
        if (expr.catchClause.param) nextShadowed.add(expr.catchClause.param)
        collectParamBodyUseTypes(expr.catchClause.body, paramNames, typesByParam, nextShadowed)
      }
      if (expr.finallyClause) collectParamBodyUseTypes(expr.finallyClause, paramNames, typesByParam, shadowed)
      return
    case 'TernaryExpr':
      collectParamBodyUseTypes(expr.cond, paramNames, typesByParam, shadowed)
      collectParamBodyUseTypes(expr.then, paramNames, typesByParam, shadowed)
      collectParamBodyUseTypes(expr.else, paramNames, typesByParam, shadowed)
      return
    case 'NewExpr':
      collectParamBodyUseTypes(expr.arg, paramNames, typesByParam, shadowed)
      return
    case 'UpdateExpr':
      recordIdent(expr.arg, 'number')
      collectParamBodyUseTypes(expr.arg, paramNames, typesByParam, shadowed)
      return
    case 'TemplateLit':
      for (const part of expr.expressions) collectParamBodyUseTypes(part, paramNames, typesByParam, shadowed)
      return
    case 'ThrowExpr':
      collectParamBodyUseTypes(expr.arg, paramNames, typesByParam, shadowed)
      return
    case 'ReturnExpr':
      if (expr.value) collectParamBodyUseTypes(expr.value, paramNames, typesByParam, shadowed)
      return
    case 'ImportExpr':
      collectParamBodyUseTypes(expr.arg, paramNames, typesByParam, shadowed)
      return
  }
}

function collectParamBodyUseTypesFromChild(
  child: Child,
  paramNames: ReadonlyMap<string, number>,
  typesByParam: Map<number, string>,
  shadowed: ReadonlySet<string>
): void {
  if (child === null || typeof child !== 'object') return
  collectParamBodyUseTypes(child, paramNames, typesByParam, shadowed)
}

function literalComparableType(expr: Expr): string | undefined {
  switch (expr.kind) {
    case 'StringLit':
    case 'TemplateLit':
      return 'string'
    case 'NumberLit':
      return 'number'
    case 'Ident':
      if (expr.name === 'true' || expr.name === 'false') return 'boolean'
      if (expr.name === 'null') return 'null'
      return undefined
    default:
      return undefined
  }
}

function inferExprTsType(
  expr: Expr,
  valueTypes: ReadonlyMap<string, string>,
  returnTypes?: ReadonlyMap<string, string>
): string | undefined {
  switch (expr.kind) {
    case 'StringLit':
    case 'TemplateLit':
      return 'string'
    case 'NumberLit':
      return 'number'
    case 'RegexLit':
      return 'RegExp'
    case 'Lambda':
      return '(...args: unknown[]) => unknown'
    case 'UnaryExpr': {
      if (expr.op === '!') return 'boolean'
      if (expr.op === '~' || expr.op === '-' || expr.op === '+') return 'number'
      return undefined
    }
    case 'BinaryExpr': {
      switch (expr.op) {
        case '==':
        case '!=':
        case '<':
        case '<=':
        case '>':
        case '>=':
          return 'boolean'
        case '||':
        case '&&':
        case '??': {
          const left = inferExprTsType(expr.left, valueTypes, returnTypes)
          const right = inferExprTsType(expr.right, valueTypes, returnTypes)
          if (!left) return right
          if (!right) return left
          return mergeInferredTypes(left, right)
        }
        case '-':
        case '*':
        case '**':
        case '/':
        case '%':
        case '&':
        case '|':
        case '^':
        case '<<':
        case '>>':
          return 'number'
        case '+': {
          const left = inferExprTsType(expr.left, valueTypes, returnTypes)
          const right = inferExprTsType(expr.right, valueTypes, returnTypes)
          return left === 'number' && right === 'number' ? 'number' : undefined
        }
      }
      return undefined
    }
    case 'Ident': {
      if (expr.name === 'true' || expr.name === 'false') return 'boolean'
      if (expr.name === 'null') return 'null'
      return valueTypes.get(expr.name)
    }
    case 'MemberExpr': {
      const objectType = inferExprTsType(expr.object, valueTypes, returnTypes)
      return objectType ? lookupObjectPropertyType(objectType, expr.property) : undefined
    }
    case 'IndexExpr': {
      const objectType = inferExprTsType(expr.object, valueTypes, returnTypes)
      return objectType ? arrayElementTypeFromType(objectType) : undefined
    }
    case 'CallExpr':
      if (expr.namedArgs && expr.namedArgs.length > 0) return undefined
      return returnTypes?.get(expr.callee)
    case 'ArrayLit': {
      if (expr.elements.length === 0) return 'unknown[]'
      let elementType: string | undefined
      for (const item of expr.elements) {
        elementType = mergeInferredTypes(elementType, inferExprTsType(item, valueTypes, returnTypes) ?? 'unknown')
      }
      return `${arrayElementTypeText(elementType ?? 'unknown')}[]`
    }
    case 'ObjectLit': {
      const fields: string[] = []
      for (const member of expr.properties) {
        if (member.kind === 'ObjectSpread') return undefined
        if (member.keyKind === 'computed') return undefined
        const valueType = inferExprTsType(member.value, valueTypes, returnTypes) ?? 'unknown'
        fields.push(`${renderObjectTypeKey(member.key)}: ${valueType}`)
      }
      return `{ ${fields.join('; ')} }`
    }
    case 'Block':
      return inferBlockTsType(expr, valueTypes, returnTypes)
    case 'ReturnExpr':
      return expr.value ? inferExprTsType(expr.value, valueTypes, returnTypes) : undefined
    default:
      return undefined
  }
}

function inferBlockTsType(
  block: Block,
  valueTypes: ReadonlyMap<string, string>,
  returnTypes?: ReadonlyMap<string, string>
): string | undefined {
  const localTypes = new Map(valueTypes)
  let out: string | undefined
  for (let i = 0; i < block.body.length; i++) {
    const item = block.body[i]!
    if (item.kind === 'LocalLet') {
      if (item.type !== undefined) {
        localTypes.set(item.name, item.type.trim())
      } else if (!item.destructureFields) {
        const valueType = inferExprTsType(item.value, localTypes, returnTypes)
        if (valueType) localTypes.set(item.name, valueType)
      }
      continue
    }
    out = inferExprTsType(item, localTypes, returnTypes)
  }
  return out
}

function renderObjectTypeKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key)
}

function arrayElementTypeText(typeText: string): string {
  return splitTopLevel(typeText, '|').length > 1 ? `(${typeText})` : typeText
}

function arrayElementTypeFromType(typeText: string): string | undefined {
  const trimmed = typeText.trim()
  if (trimmed.endsWith('[]')) {
    const element = trimmed.slice(0, -2).trim()
    if (element.startsWith('(') && element.endsWith(')')) {
      const inner = element.slice(1, -1).trim()
      if (inner) return inner
    }
    return element || undefined
  }
  if (trimmed.startsWith('Array<') && trimmed.endsWith('>')) {
    const inner = trimmed.slice('Array<'.length, -1).trim()
    return inner || undefined
  }
  return undefined
}

function lookupObjectPropertyType(typeText: string, property: string): string | undefined {
  let out: string | undefined
  const parts = splitTopLevel(typeText, '|')
  for (const part of parts) {
    const found = lookupSingleObjectPropertyType(part.trim(), property)
    if (!found) return undefined
    out = mergeInferredTypes(out, found)
  }
  return out
}

function lookupSingleObjectPropertyType(typeText: string, property: string): string | undefined {
  const trimmed = typeText.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined
  const inner = trimmed.slice(1, -1).trim()
  if (!inner) return undefined
  for (const field of splitTopLevel(inner, ';')) {
    const colon = indexOfTopLevel(field, ':')
    if (colon < 0) continue
    const rawKey = field.slice(0, colon).trim()
    const key = parseObjectTypeKey(rawKey)
    if (key !== property) continue
    const value = field.slice(colon + 1).trim()
    return value || undefined
  }
  return undefined
}

function parseObjectTypeKey(rawKey: string): string {
  if (rawKey.startsWith('"') || rawKey.startsWith("'")) {
    try {
      return JSON.parse(rawKey)
    } catch {
      return rawKey
    }
  }
  return rawKey
}

function indexOfTopLevel(s: string, needle: string): number {
  let depth = 0
  let quote: string | null = null
  let escape = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    if (quote) {
      if (escape) {
        escape = false
      } else if (ch === '\\') {
        escape = true
      } else if (ch === quote) {
        quote = null
      }
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{' || ch === '<') depth++
    else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') depth = Math.max(0, depth - 1)
    else if (depth === 0 && ch === needle) return i
  }
  return -1
}

function collectCallsFromStmt(stmt: Stmt, visit: (call: CallExpr) => void): void {
  if (stmt.kind !== 'LetDecl') return
  collectCallsFromExpr(stmt.value, visit)
}

function collectCallsFromExpr(expr: Expr, visit: (call: CallExpr) => void): void {
  switch (expr.kind) {
    case 'CallExpr':
      visit(expr)
      for (const arg of expr.args) collectCallsFromExpr(arg, visit)
      for (const arg of expr.namedArgs ?? []) collectCallsFromExpr(arg.value, visit)
      for (const child of expr.children ?? []) collectCallsFromChild(child, visit)
      return
    case 'Lambda':
      collectCallsFromExpr(expr.body, visit)
      return
    case 'Block':
      for (const item of expr.body) {
        if (item.kind === 'LocalLet') collectCallsFromExpr(item.value, visit)
        else collectCallsFromExpr(item, visit)
      }
      return
    case 'TagCall':
      for (const prop of expr.props) collectCallsFromExpr(prop.value, visit)
      for (const child of expr.children) collectCallsFromChild(child, visit)
      return
    case 'ArrayLit':
      for (const item of expr.elements) collectCallsFromExpr(item, visit)
      return
    case 'ObjectLit':
      for (const prop of expr.properties) {
        if (prop.kind === 'ObjectSpread') collectCallsFromExpr(prop.arg, visit)
        else {
          if (prop.computedKey) collectCallsFromExpr(prop.computedKey, visit)
          collectCallsFromExpr(prop.value, visit)
        }
      }
      return
    case 'MemberExpr':
      collectCallsFromExpr(expr.object, visit)
      return
    case 'IndexExpr':
      collectCallsFromExpr(expr.object, visit)
      collectCallsFromExpr(expr.index, visit)
      return
    case 'MethodCallExpr':
      collectCallsFromExpr(expr.object, visit)
      for (const arg of expr.args) collectCallsFromExpr(arg, visit)
      return
    case 'MemberAssignExpr':
      collectCallsFromExpr(expr.target, visit)
      collectCallsFromExpr(expr.value, visit)
      return
    case 'InvokeExpr':
      collectCallsFromExpr(expr.callee, visit)
      for (const arg of expr.args) collectCallsFromExpr(arg, visit)
      return
    case 'AssignExpr':
      collectCallsFromExpr(expr.value, visit)
      return
    case 'BinaryExpr':
      collectCallsFromExpr(expr.left, visit)
      collectCallsFromExpr(expr.right, visit)
      return
    case 'UnaryExpr':
    case 'NonNullAssertExpr':
    case 'AsExpr':
    case 'AwaitExpr':
      collectCallsFromExpr(expr.arg, visit)
      return
    case 'IfExpr':
      collectCallsFromExpr(expr.cond, visit)
      collectCallsFromExpr(expr.then, visit)
      if (expr.else) collectCallsFromExpr(expr.else, visit)
      return
    case 'ForExpr':
      collectCallsFromExpr(expr.iter, visit)
      collectCallsFromExpr(expr.body, visit)
      return
    case 'TryExpr':
      collectCallsFromExpr(expr.body, visit)
      if (expr.catchClause) collectCallsFromExpr(expr.catchClause.body, visit)
      if (expr.finallyClause) collectCallsFromExpr(expr.finallyClause, visit)
      return
    case 'TernaryExpr':
      collectCallsFromExpr(expr.cond, visit)
      collectCallsFromExpr(expr.then, visit)
      collectCallsFromExpr(expr.else, visit)
      return
    case 'NewExpr':
      collectCallsFromExpr(expr.arg, visit)
      return
    case 'UpdateExpr':
      collectCallsFromExpr(expr.arg, visit)
      return
    case 'TemplateLit':
      for (const part of expr.expressions) collectCallsFromExpr(part, visit)
      return
    case 'SpreadElement':
      collectCallsFromExpr(expr.arg, visit)
      return
    case 'ThrowExpr':
      collectCallsFromExpr(expr.arg, visit)
      return
    case 'ReturnExpr':
      if (expr.value) collectCallsFromExpr(expr.value, visit)
      return
    case 'ImportExpr':
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

function collectCallsFromChild(child: Child, visit: (call: CallExpr) => void): void {
  if (child === null || typeof child !== 'object') return
  collectCallsFromExpr(child, visit)
}

class Codegen {
  /** Stack of binding-name sets shadowing top-level cells (innermost last). */
  private readonly shadowed: Set<string>[] = []
  /** Stack of scoped-component contexts pushed at LetDecl emit time. */
  private readonly scopes: ScopeCtx[] = []
  /** Streaming output buffer. */
  private buffer = ''
  /** Per-statement mapping anchors (one per top-level statement). */
  private readonly stmtMappings: StmtMapping[] = []
  /** Per-token mapping spans (one per emitted leaf-ish source span). */
  private readonly tokenMappings: TokenMapping[] = []

  constructor(
    private readonly cells: Map<string, CellKind>,
    private readonly scopedComponents: Map<string, ScopeCtx>,
    private readonly tsMode: boolean = false,
    private readonly declaredTypeNames: ReadonlySet<string> = new Set(),
    private readonly declaredInterfaceNames: ReadonlySet<string> = new Set(),
    private readonly anonInterfaceForLet: ReadonlyMap<LetDecl, string> = new Map(),
    private readonly canonicalNamesForFile: ReadonlyMap<string, string> | undefined = undefined,
    private readonly typeAliasBodies: ReadonlyMap<string, string> = new Map(),
    private readonly inferredParamTypes: InferredParamTypes = new Map()
  ) {}

  write(text: string): void {
    this.buffer += text
  }

  recordStmtMapping(srcOffset: number): void {
    this.stmtMappings.push({ jsOffset: this.buffer.length, srcOffset })
  }

  /**
   * Run `fn` and record a TokenMapping spanning the byte range `fn` writes
   * into the buffer. The mapping ties that generated span back to
   * `[srcStart, srcEnd)` in the `.tu` source.
   */
  private mark(srcStart: number, srcEnd: number, fn: () => void): void {
    const jsStart = this.buffer.length
    fn()
    const jsEnd = this.buffer.length
    if (jsEnd > jsStart) {
      this.tokenMappings.push({ jsStart, jsEnd, srcStart, srcEnd })
    }
  }

  finish(): BuildResult {
    return {
      code: this.buffer,
      stmtMappings: this.stmtMappings,
      tokenMappings: this.tokenMappings,
    }
  }

  emitStmt(stmt: Stmt): void {
    if (stmt.kind === 'ImportDecl') {
      const src = this.rewriteSource(stmt.source)
      const parts: string[] = []
      if (stmt.default !== undefined) parts.push(stmt.default)
      if (stmt.namespace !== undefined) parts.push(`* as ${stmt.namespace}`)
      if (stmt.names.length > 0) parts.push(`{ ${stmt.names.join(', ')} }`)
      this.write(`import ${parts.join(', ')} from ${JSON.stringify(src)}`)
      return
    }
    if (stmt.kind === 'ReExportDecl') {
      const src = this.rewriteSource(stmt.source)
      this.write(`export { ${stmt.names.join(', ')} } from ${JSON.stringify(src)}`)
      return
    }
    if (stmt.kind === 'TypeAlias') {
      // Only reached in TS mode; buildBody skips this stmt in JS mode.
      const prefix = stmt.exported ? 'export type' : 'type'
      this.write(`${prefix} `)
      this.mark(stmt.nameStart, stmt.nameEnd, () => this.write(stmt.name))
      this.write(' = ')
      this.mark(stmt.typeStart, stmt.typeEnd, () => this.write(stmt.type))
      return
    }
    if (stmt.kind === 'InterfaceDecl') {
      this.emitInterfaceDecl(stmt)
      return
    }
    if (stmt.kind === 'ExceptionDecl') {
      this.emitExceptionDecl(stmt)
      return
    }
    const decl = stmt
    const prefix = decl.exported ? 'export const' : 'const'
    const kind = this.cells.get(decl.name) ?? 'state'
    const ctx = this.scopedComponents.get(decl.name)
    if (ctx) this.scopes.push(ctx)
    try {
      // M3.9 + M9: for an exported lambda with all-typed params, emit a
      // named `${Name}Props` interface BEFORE the const so downstream
      // consumers (TS code reading the .d.ts) get a reusable shape.
      // Lambdas with any untyped param are skipped — we don't want to
      // invent `unknown` fields. If the user has hand-declared a
      // `${Name}Props` type alias in this module, skip the auto-emit to
      // avoid TS "Duplicate identifier" — the hand-written shape wins.
      //
      // M9 update: every prop is `?:` optional and we append a
      // `children?: Child[]` slot. Rationale: M6.1's named-arg call form
      // (`Card(title: "x")`) lets callers omit any prop — runtime gets
      // `undefined` for missing keys — so the interface should match
      // call-site reality. The `children` slot is appended unless the
      // lambda already declares its own `children` param (in which case
      // that param's type wins).
      // Destructured params are skipped — when the user writes
      // `({ title }: CardProps) =>`, the prop shape is already named
      // (CardProps), so auto-emitting a duplicate `${Name}Props`
      // interface would just create a redundant alias.
      if (
        this.tsMode &&
        decl.exported &&
        decl.value.kind === 'Lambda' &&
        decl.value.params.length >= 1 &&
        decl.value.params.every((p) => p.type !== undefined) &&
        decl.value.params.every((p) => !p.destructureFields) &&
        !this.declaredTypeNames.has(`${decl.name}Props`)
      ) {
        const params = decl.value.params
        const hasOwnChildren = params.some((p) => p.name === 'children')
        this.write(`export interface ${decl.name}Props { `)
        for (let i = 0; i < params.length; i++) {
          if (i > 0) this.write('; ')
          const p = params[i]!
          this.mark(p.nameStart, p.nameEnd, () => this.write(p.name))
          this.write('?: ')
          if (p.typeStart !== undefined && p.typeEnd !== undefined) {
            this.mark(p.typeStart, p.typeEnd, () => this.write(p.type!))
          } else {
            this.write(p.type!)
          }
        }
        if (!hasOwnChildren) {
          this.write('; children?: Child[]')
        }
        this.write(' }\n')
      }
      this.write(`${prefix} `)
      // Mark the bound name so a TS error on `count` lands on the source `count`.
      this.mark(decl.nameStart, decl.nameEnd, () => this.write(decl.name))
      // Emit a TS type annotation when the user supplied one.
      //
      // Default behavior: lambdas pass through as-is; state / computed cells
      // get the declared type wrapped in their Signal box so the variable's
      // actual type matches the wrapped value (M2.2 ergonomic).
      //
      // Escape hatch: if the user's annotation ALREADY starts with
      // `Signal.State<` / `Signal.Computed<`, we trust them and skip the
      // double-wrap — useful when they want to declare an explicit Signal
      // shape (e.g. `let cell: Signal.State<MyShape> = …`).
      if (this.tsMode && decl.type !== undefined) {
        const t = decl.type.trim()
        const preWrapped =
          t.startsWith('Signal.State<') || t.startsWith('Signal.Computed<')
        if (preWrapped || kind === 'function') {
          this.write(': ')
          if (decl.typeStart !== undefined && decl.typeEnd !== undefined) {
            this.mark(decl.typeStart, decl.typeEnd, () => this.write(decl.type!))
          } else {
            this.write(decl.type)
          }
        } else if (kind === 'computed') {
          this.write(': Signal.Computed<')
          if (decl.typeStart !== undefined && decl.typeEnd !== undefined) {
            this.mark(decl.typeStart, decl.typeEnd, () => this.write(decl.type!))
          } else {
            this.write(decl.type)
          }
          this.write('>')
        } else {
          this.write(': Signal.State<')
          if (decl.typeStart !== undefined && decl.typeEnd !== undefined) {
            this.mark(decl.typeStart, decl.typeEnd, () => this.write(decl.type!))
          } else {
            this.write(decl.type)
          }
          this.write('>')
        }
      }
      this.write(' = ')
      if (kind === 'function') {
        this.emitExpr(decl.value)
        return
      }
      if (kind === 'computed') {
        const v = decl.value as CallExpr
        const arg = v.args[0]
        // Widen empty `computed([])` to `Signal.Computed<any[]>` so
        // assignments / reads / iteration aren't blocked by tsserver's
        // `never[]` inference. `any[]` (vs `unknown[]`) keeps `for item in`
        // ergonomic — users wanting tighter types should annotate.
        const wrapper =
          this.tsMode && decl.type === undefined && isEmptyArray(arg)
            ? 'new Signal.Computed<any[]>(() => '
            : 'new Signal.Computed(() => '
        this.write(wrapper)
        if (arg) {
          // Same arrow-body ambiguity guard as emitLambda: `() => { … }` reads
          // as a block, not an object literal — paren-wrap to disambiguate.
          if (arg.kind === 'ObjectLit') {
            this.write('(')
            this.emitExpr(arg)
            this.write(')')
          } else {
            this.emitExpr(arg)
          }
        } else this.write('undefined')
        this.write(')')
        return
      }
      // state
      const widenEmpty =
        this.tsMode && decl.type === undefined && isEmptyArray(decl.value)
      this.write(widenEmpty ? 'new Signal.State<any[]>(' : 'new Signal.State(')
      // M8 Phase 2.5 — `let X: I = { … }` wraps the object in
      // `type.tag(I, …)` so `type.of(value)` recovers the user's
      // interface descriptor.
      //
      // M8 Phase 3 — same wrapping for UNTYPED `let X = { … }`, using
      // a synthesized anonymous descriptor (see `synthesizeAnonInterfaces`).
      // Either path: pick the descriptor name first, then emit one
      // `type.tag(<name>, …)` wrapper around the ObjectLit.
      const annot = decl.type?.trim()
      const explicitTag =
        decl.value.kind === 'ObjectLit' &&
        annot !== undefined &&
        /^[A-Z]\w*$/.test(annot) &&
        this.declaredInterfaceNames.has(annot)
          ? annot
          : null
      const anonTag =
        decl.value.kind === 'ObjectLit'
          ? this.anonInterfaceForLet.get(decl) ?? null
          : null
      const tagName = explicitTag ?? anonTag
      if (tagName !== null) {
        this.write('type.tag(')
        if (explicitTag !== null && decl.typeStart !== undefined && decl.typeEnd !== undefined) {
          this.mark(decl.typeStart, decl.typeEnd, () => this.write(explicitTag))
        } else {
          this.write(tagName)
        }
        this.write(', ')
        this.emitExpr(decl.value)
        this.write(')')
      } else {
        this.emitExpr(decl.value)
      }
      this.write(')')
    } finally {
      if (ctx) this.scopes.pop()
    }
  }

  /**
   * In TS-emit mode, rewrite a `./foo.tu` import source to `./foo.ts` so
   * tsserver resolves the sibling shadow file. Other extensions and
   * non-relative paths pass through unchanged.
   */
  private rewriteSource(source: string): string {
    if (this.tsMode && source.endsWith('.tu')) {
      return source.slice(0, -'.tu'.length) + '.ts'
    }
    return source
  }

  emitExpr(expr: Expr): void {
    switch (expr.kind) {
      case 'Lambda':
        this.emitLambda(expr)
        return
      case 'TagCall':
        this.emitTagCall(expr)
        return
      case 'CallExpr':
        this.emitCallExpr(expr)
        return
      case 'BinaryExpr':
        this.emitBinaryExpr(expr)
        return
      case 'StringLit':
        this.mark(expr.start, expr.end, () => this.write(JSON.stringify(expr.value)))
        return
      case 'NumberLit':
        this.mark(expr.start, expr.end, () => this.write(String(expr.value)))
        return
      case 'Ident':
        this.emitIdentRead(expr.name, expr.start, expr.end)
        return
      case 'Block':
        this.emitBlock(expr)
        return
      case 'IfExpr':
        this.emitIfExpr(expr)
        return
      case 'ForExpr':
        this.emitForExpr(expr)
        return
      case 'StyleBlock':
        this.emitStyleBlock(expr)
        return
      case 'MarkdownBlock':
        this.emitMarkdownBlock(expr)
        return
      case 'AssignExpr':
        this.emitAssignExpr(expr)
        return
      case 'MemberAssignExpr':
        this.write('(')
        this.emitExpr(expr.target)
        this.write(' = ')
        this.emitExpr(expr.value)
        this.write(')')
        return
      case 'InvokeExpr':
        // `(lambda)(args)` IIFE — JS doesn't allow `() => {…}(args)`
        // directly, the arrow has to be paren-wrapped before the
        // call-args list. Wrap defensively for all Lambda callees so
        // both the IIFE shape and edge cases like `((x) => x)(1)`
        // emit valid JS.
        if (expr.callee.kind === 'Lambda') {
          this.write('(')
          this.emitExpr(expr.callee)
          this.write(')')
        } else {
          this.emitExpr(expr.callee)
        }
        this.write('(')
        for (let i = 0; i < expr.args.length; i++) {
          if (i > 0) this.write(', ')
          this.emitExpr(expr.args[i]!)
        }
        this.write(')')
        return
      case 'RegexLit':
        this.mark(expr.start, expr.end, () => this.write(expr.text))
        return
      case 'ClassRef':
        this.emitClassRef(expr)
        return
      case 'ArrayLit':
        this.emitArrayLit(expr)
        return
      case 'ObjectLit':
        this.emitObjectLit(expr)
        return
      case 'MemberExpr':
        this.emitMemberExpr(expr)
        return
      case 'MethodCallExpr':
        this.emitMethodCallExpr(expr)
        return
      case 'IndexExpr':
        this.emitExpr(expr.object)
        this.write(expr.optional ? '?.[' : '[')
        this.emitExpr(expr.index)
        this.write(']')
        return
      case 'UnaryExpr':
        // Wrap in parens so the result composes safely inside larger
        // expressions (e.g. `a + !b` or `a - -b` read correctly without
        // relying on consumer precedence).
        this.write(`(${expr.op}`)
        this.emitExpr(expr.arg)
        this.write(')')
        return
      case 'NonNullAssertExpr':
        // TS-only: emit `expr!` so tsserver sees the narrowing. In JS-emit
        // mode (default for build / runtime) the assertion is erased —
        // it has no JS semantics. We DON'T just pass through to emitExpr
        // because at runtime `(x)!` would parse as `x!=undefined` lookup
        // ambiguity in some contexts; keep it strictly TS.
        if (this.tsMode) {
          this.emitExpr(expr.arg)
          this.write('!')
        } else {
          this.emitExpr(expr.arg)
        }
        return
      case 'AsExpr':
        // TS mode: emit `(arg as Type)` so tsserver picks up the cast.
        // JS mode: erase — cast has no runtime effect. The wrapping
        // parens guard against precedence surprises when the cast sits
        // inside a larger expression (e.g. `x as Foo + y`).
        if (this.tsMode) {
          this.write('(')
          this.emitExpr(expr.arg)
          this.write(` as ${expr.typeText})`)
        } else {
          this.emitExpr(expr.arg)
        }
        return
      case 'ThrowExpr':
        // Expression position: wrap in IIFE so the throw can sit
        // anywhere a value is expected. Block context emits a clean
        // `throw …;` directly via `emitBlockStmt`.
        this.write('((() => { throw ')
        this.emitExpr(expr.arg)
        this.write('; })())')
        return
      case 'ReturnExpr':
        // Same IIFE trick as ThrowExpr — `return` inside an IIFE just
        // exits that IIFE (the value still escapes via the outer eval).
        // Block context (the common case) bypasses this branch.
        this.write('((() => { return')
        if (expr.value !== undefined) {
          this.write(' ')
          this.emitExpr(expr.value)
        }
        this.write('; })())')
        return
      case 'TryExpr':
        this.emitTryExpr(expr)
        return
      case 'TernaryExpr':
        this.write('(')
        this.emitExpr(expr.cond)
        this.write(' ? ')
        this.emitExpr(expr.then)
        this.write(' : ')
        this.emitExpr(expr.else)
        this.write(')')
        return
      case 'NewExpr':
        this.write('(new ')
        this.emitExpr(expr.arg)
        this.write(')')
        return
      case 'UpdateExpr':
        // Emit the JS-native form so the result value behaves like JS
        // (prefix returns the new value; postfix returns the old). We
        // bypass Tu's .get()/.set() injection here by emitting the
        // operand directly — the operand is gated to ident / member
        // access by parsePostfix, so JS's update semantics apply.
        if (expr.prefix) {
          this.write(`(${expr.op}`)
          this.emitUpdateOperand(expr.arg)
          this.write(')')
        } else {
          this.write('(')
          this.emitUpdateOperand(expr.arg)
          this.write(`${expr.op})`)
        }
        return
      case 'TemplateLit':
        this.emitTemplateLit(expr)
        return
      case 'SpreadElement':
        this.write('...')
        this.emitExpr(expr.arg)
        return
      case 'AwaitExpr':
        this.write('(await ')
        this.emitExpr(expr.arg)
        this.write(')')
        return
      case 'ImportExpr':
        this.write('import(')
        this.emitExpr(expr.arg)
        this.write(')')
        return
      case 'ExternalLambda':
        this.emitExternalLambda(expr)
        return
    }
  }

  private emitExternalLambda(node: ExternalLambda): void {
    if (node.lang !== 'JS') {
      throw new Error(`external ${node.lang} blocks are not yet supported (only \`external JS\`)`)
    }
    if (node.async) this.write('async ')
    this.write('(')
    for (let i = 0; i < node.params.length; i++) {
      if (i > 0) this.write(', ')
      const p = node.params[i]!
      this.mark(p.nameStart, p.nameEnd, () => this.write(p.name))
      // M9 Phase B — untyped params default to `unknown` instead of
      // TS's implicit `any`. Forces narrow / cast at use sites; pairs
      // with the M8 `type.as` helper for typed runtime casts.
      if (this.tsMode) {
        this.write(': ')
        if (p.type !== undefined && p.typeStart !== undefined && p.typeEnd !== undefined) {
          this.mark(p.typeStart, p.typeEnd, () => this.write(p.type!))
        } else {
          this.write(p.type ?? 'unknown')
        }
      }
    }
    this.write(')')
    if (this.tsMode && node.returnType !== undefined) {
      this.write(': ')
      if (node.returnTypeStart !== undefined && node.returnTypeEnd !== undefined) {
        this.mark(node.returnTypeStart, node.returnTypeEnd, () => this.write(node.returnType!))
      } else {
        this.write(node.returnType)
      }
    }
    this.write(' => {')
    // Paste the raw body verbatim. The `mark` call ties the entire
    // emitted region back to the source body span so a TS error inside
    // the pasted JS still squiggles in the .tu file at the right place.
    this.mark(node.bodyStart, node.bodyEnd, () => this.write(node.body))
    this.write('}')
  }

  /** Inside an `UpdateExpr` we want to bypass cell `.get()` injection
   *  on the target — `++count` should emit `++count`, not `++count.get()`.
   *  Recurse manually for ident / member / index access. */
  private emitUpdateOperand(node: Expr): void {
    if (node.kind === 'Ident') {
      this.mark(node.start, node.end, () => this.write(node.name))
      return
    }
    // Member / index access already emits their object via emitExpr —
    // that path injects .get() on cell idents nested inside, which is
    // what we want (the *target* of the increment is the leaf
    // property, not the cell itself).
    this.emitExpr(node)
  }

  private emitTemplateLit(node: TemplateLit): void {
    this.write('`')
    for (let i = 0; i < node.quasis.length; i++) {
      this.write(escapeTemplateChunk(node.quasis[i]!))
      if (i < node.expressions.length) {
        this.write('${')
        this.emitExpr(node.expressions[i]!)
        this.write('}')
      }
    }
    this.write('`')
  }

  private emitTryExpr(node: TryExpr): void {
    // Wrap in an IIFE so the entire try yields a value. Each branch's
    // last expression becomes a `return` so the IIFE produces it.
    this.write('(() => {\n')
    this.emitTryStmt(node, /*allowReturn*/ true)
    this.write('\n})()')
  }

  /** Emit just the `try { … } catch { … } finally { … }` shape, without
   *  the IIFE wrap. Used by emitTryExpr (with wrap) and by
   *  emitBlockTrailingExpr / emitBlockStmt (no wrap — direct
   *  statement). The latter avoids the redundant IIFE on the common
   *  case where try is at a trailing or stmt position inside a block,
   *  AND it sidesteps the async-IIFE problem (an embedded `await`
   *  inside the try body would be a syntax error in a sync IIFE). */
  private emitTryStmt(node: TryExpr, allowReturn: boolean): void {
    this.write('try ')
    this.emitBlockStatementBody(node.body, allowReturn)
    if (node.catchClause) {
      const c = node.catchClause
      if (c.param) {
        this.write(' catch (')
        this.mark(c.paramStart, c.paramEnd, () => this.write(c.param))
        // TS only allows `unknown` (or `any`) on catch params since 4.0.
        // Tu's M9 type-aware catch annotation (`catch (e: AError | BError)`)
        // is consumed by the exception-scope checker; the TS shadow
        // always emits `: unknown` so tsserver doesn't reject. The body's
        // `type.is(e, AError)` narrowing produces the right inferred type.
        if (this.tsMode && c.type) this.write(`: unknown`)
        this.write(') ')
      } else {
        this.write(' catch ')
      }
      this.emitBlockStatementBody(c.body, allowReturn)
    }
    if (node.finallyClause) {
      this.write(' finally ')
      // Finally body's value is discarded — emit as plain block, no return.
      this.emitBlockStatementBody(node.finallyClause, /*allowReturn*/ false)
    }
  }

  /** Emit a Tu Block as a JS `{ … }` body. When `allowReturn` is true
   *  the last expression becomes `return …;` so the value escapes the
   *  enclosing IIFE; otherwise it's emitted as a plain expression
   *  statement. Used by emitTryExpr. */
  private emitBlockStatementBody(node: Block, allowReturn: boolean): void {
    this.write('{\n')
    let lastExprIdx = -1
    if (allowReturn) {
      for (let i = node.body.length - 1; i >= 0; i--) {
        if (node.body[i]!.kind !== 'LocalLet') {
          lastExprIdx = i
          break
        }
      }
    }
    for (let i = 0; i < node.body.length; i++) {
      const item = node.body[i]!
      this.write('  ')
      if (item.kind === 'LocalLet') {
        this.emitLocalLet(item as LocalLet)
        this.write(';\n')
      } else if (i === lastExprIdx) {
        this.emitBlockTrailingExpr(item as Expr)
      } else {
        this.emitBlockStmt(item as Expr)
      }
    }
    this.write('}')
  }

  /** Emit an item that appears in the trailing (return-position) slot
   *  of a Block. Recognizes the four Tu nodes that *are* JS statements
   *  (Throw / Return / Try) and emits them cleanly without an IIFE
   *  wrap; everything else gets the usual `return …;` prefix. */
  private emitBlockTrailingExpr(item: Expr): void {
    if (item.kind === 'ThrowExpr') {
      this.write('throw ')
      this.emitExpr(item.arg)
      this.write(';\n')
      return
    }
    if (item.kind === 'ReturnExpr') {
      this.write('return')
      if (item.value !== undefined) {
        this.write(' ')
        this.emitExpr(item.value)
      }
      this.write(';\n')
      return
    }
    if (item.kind === 'TryExpr') {
      // Direct try-statement form. Each arm's trailing expr becomes
      // `return …;` so the value escapes via the enclosing block's
      // own return. Avoids the IIFE that emitTryExpr would otherwise
      // emit, which has two benefits: smaller output AND lets `await`
      // inside the body work in async contexts (a sync IIFE would
      // wrap the await and turn it into a syntax error).
      this.emitTryStmt(item, /*allowReturn*/ true)
      this.write('\n')
      return
    }
    this.write('return ')
    this.emitExpr(item)
    this.write(';\n')
  }

  /** Emit a Block item that's NOT in trailing position — its value is
   *  discarded, but Throw / Return / Try / If are still recognized as
   *  statements so they don't pay the IIFE-wrap cost. The `if` case is
   *  load-bearing for early-return patterns: `if (x < 0) { return 0 }`
   *  in source must lower to `if (...) { return 0; }` so the return
   *  exits the *outer* lambda, not just the if's IIFE. */
  private emitBlockStmt(item: Expr): void {
    if (item.kind === 'ThrowExpr') {
      this.write('throw ')
      this.emitExpr(item.arg)
      this.write(';\n')
      return
    }
    if (item.kind === 'ReturnExpr') {
      this.write('return')
      if (item.value !== undefined) {
        this.write(' ')
        this.emitExpr(item.value)
      }
      this.write(';\n')
      return
    }
    if (item.kind === 'IfExpr') {
      this.emitIfStatement(item)
      return
    }
    if (item.kind === 'TryExpr') {
      // Statement-position try doesn't need a return value; emit each
      // arm with allowReturn=false so the value is just discarded.
      this.emitTryStmt(item, /*allowReturn*/ false)
      this.write('\n')
      return
    }
    this.emitExpr(item)
    this.write(';\n')
  }

  /** Emit an IfExpr as a JS `if (…) { … } else { … }` statement so
   *  inner `throw` / `return` reach the surrounding scope. The block
   *  bodies recurse through `emitBlockStatementBody` with
   *  `allowReturn: false` since the parent context already discards
   *  the value. */
  private emitIfStatement(node: IfExpr): void {
    this.write('if (')
    this.emitExpr(node.cond)
    this.write(') ')
    this.emitBlockStatementBody(node.then, /*allowReturn*/ false)
    if (node.else !== undefined) {
      this.write(' else ')
      if (node.else.kind === 'IfExpr') {
        this.emitIfStatement(node.else)
        return
      }
      this.emitBlockStatementBody(node.else, /*allowReturn*/ false)
    }
    this.write('\n')
  }

  private emitMemberExpr(node: MemberExpr): void {
    // Recurse into the object first — if it's a cell ident, this emits the
    // `.get()` injection automatically. Then append the property name as a
    // plain JS dot-access. The property is always a static identifier
    // (parser guarantees `Ident` after the postfix dot).
    this.emitExpr(node.object)
    this.write(node.optional ? '?.' : '.')
    this.mark(node.propertyStart, node.propertyEnd, () => this.write(node.property))
  }

  private emitMethodCallExpr(node: MethodCallExpr): void {
    // Special-case: `<cell>.get()` / `<cell>.set(x)` written by the
    // user directly — emit verbatim instead of inject + double-call.
    // Without this, source `items.get()` becomes `items.get().get()`
    // because emitExpr(object) auto-injects `.get()` on cell idents.
    // The user-written `.get()` is the unwrap they meant.
    // Distinguishing the user-written cell unwrap (`cell.get()`,
    // `cell.set(x)`) from a method on a cell-held object (`map.get(k)`,
    // `arr.set(0, x)`) by arity — Tu's cell API has 0-arg get / 1-arg
    // set, every other shape is a method that wants the implicit
    // cell unwrap.
    const isCellUnwrap =
      node.object.kind === 'Ident' &&
      !node.optional &&
      this.isStateOrComputedCell(node.object.name) &&
      ((node.property === 'get' && node.args.length === 0) ||
        (node.property === 'set' && node.args.length === 1))
    if (isCellUnwrap) {
      this.mark(node.object.start, node.object.end, () => this.write((node.object as { name: string }).name))
      this.write('.')
      this.mark(node.propertyStart, node.propertyEnd, () => this.write(node.property))
      this.write('(')
      for (let i = 0; i < node.args.length; i++) {
        if (i > 0) this.write(', ')
        this.emitExpr(node.args[i]!)
      }
      this.write(')')
      return
    }
    this.emitExpr(node.object)
    // Empty property + optional flag = optional direct call (`fn?.()`).
    // The parser uses MethodCallExpr-with-empty-property for this shape
    // since its layout (object + args + propertyStart anchor) already
    // covers what we need to emit.
    if (node.optional && node.property === '') {
      this.write('?.(')
    } else {
      this.write(node.optional ? '?.' : '.')
      this.mark(node.propertyStart, node.propertyEnd, () => this.write(node.property))
      this.write('(')
    }
    for (let i = 0; i < node.args.length; i++) {
      if (i > 0) this.write(', ')
      this.emitExpr(node.args[i]!)
    }
    this.write(')')
  }

  /** Lookup helper for the explicit-`.get()` / `.set()` short-circuit
   *  in emitMethodCallExpr. Honors shadowing — a lambda param named
   *  the same as a top-level cell shouldn't trigger the bypass. */
  private isStateOrComputedCell(name: string): boolean {
    for (let i = this.shadowed.length - 1; i >= 0; i--) {
      if (this.shadowed[i]?.has(name)) return false
    }
    const kind = this.cells.get(name)
    return kind === 'state' || kind === 'computed'
  }

  private emitArrayLit(node: ArrayLit): void {
    this.write('[')
    for (let i = 0; i < node.elements.length; i++) {
      if (i > 0) this.write(', ')
      this.emitExpr(node.elements[i]!)
    }
    this.write(']')
  }

  private emitObjectLit(node: ObjectLit): void {
    if (node.properties.length === 0) {
      this.write('{}')
      return
    }
    this.write('{ ')
    for (let i = 0; i < node.properties.length; i++) {
      if (i > 0) this.write(', ')
      const p = node.properties[i]!
      if (p.kind === 'ObjectSpread') {
        this.write('...')
        this.emitExpr(p.arg)
        continue
      }
      // Quote string keys (and ident keys that aren't valid JS identifiers,
      // though the parser only accepts valid Ident tokens for the ident case
      // so we trust those). Mark the key span so cross-language navigation
      // lands on the source key.
      if (p.keyKind === 'computed') {
        this.write('[')
        if (p.computedKey) this.emitExpr(p.computedKey)
        this.write(']')
      } else {
        const emitted = p.keyKind === 'string' ? JSON.stringify(p.key) : p.key
        this.mark(p.keyStart, p.keyEnd, () => this.write(emitted))
      }
      this.write(': ')
      this.emitExpr(p.value)
    }
    this.write(' }')
  }

  private emitLambda(node: Lambda): void {
    // Destructured-param fields shadow module cells the same way a plain
    // param ident does — `({ count }) => count` reads the destructured
    // local, not a module cell named `count`.
    const paramNames: string[] = []
    for (const p of node.params) {
      if (p.destructureFields) paramNames.push(...p.destructureFields)
      else paramNames.push(p.name)
    }
    this.shadowed.push(new Set(paramNames))
    try {
      if (node.async) this.write('async ')
      this.write('(')
      for (let i = 0; i < node.params.length; i++) {
        if (i > 0) this.write(', ')
        const p = node.params[i]!
        if (p.destructureFields) {
          // M9 — TS-native object destructuring pattern. Mark the brace
          // range so an error on the pattern lands on the source `{ … }`.
          this.mark(p.nameStart, p.nameEnd, () =>
            this.write(`{ ${p.destructureFields!.join(', ')} }`)
          )
        } else {
          // Mark the param name so a TS error on the param identifier maps
          // back to its source position.
          this.mark(p.nameStart, p.nameEnd, () => this.write(p.name))
        }
        // In TS mode, preserve `: type` annotations from the Tu source so
        // tsserver can drive IDE features and `.d.ts` generation. M9
        // Phase B: untyped params default to `unknown` (not TS's
        // implicit `any`) — forces narrow at use sites. Phase D starts
        // with single-file first-call inference for omitted annotations.
        if (this.tsMode) {
          const inferred = this.inferredParamTypes.get(node)?.get(i)
          this.write(': ')
          if (p.type !== undefined && p.typeStart !== undefined && p.typeEnd !== undefined) {
            this.mark(p.typeStart, p.typeEnd, () => this.write(p.type!))
          } else {
            this.write(p.type ?? inferred ?? 'unknown')
          }
        }
      }
      this.write(')')
      if (this.tsMode && node.returnType !== undefined) {
        this.write(': ')
        if (node.returnTypeStart !== undefined && node.returnTypeEnd !== undefined) {
          this.mark(node.returnTypeStart, node.returnTypeEnd, () => this.write(node.returnType!))
        } else {
          this.write(node.returnType)
        }
      }
      this.write(' => ')
      // An object literal directly after `=>` is grammatically ambiguous
      // with a function-body block in JS — wrap it in parens so the parser
      // sees an expression, not a labeled-statement block.
      if (node.body.kind === 'ObjectLit') {
        this.write('(')
        this.emitExpr(node.body)
        this.write(')')
      } else if (node.body.kind === 'Block') {
        // Lambda body is a Block. Three sub-cases:
        //   1. Empty / single-expression block with no LocalLet and no
        //      control flow — keep the tight expression-bodied form
        //      `(args) => (expr)` for byte-budget reasons (this is
        //      the common `() => div { "hi" }` pattern after the
        //      block-flatten parser pass).
        //   2. Multi-statement block (or single-stmt with LocalLet) —
        //      statement-bodied `(args) => { stmts; return last; }`.
        //      The expression-bodied form here would emit `() => IIFE`,
        //      which is redundant AND breaks `(() => {...})()` IIFE
        //      patterns: the outer call invokes the lambda whose body
        //      is itself the IIFE; the IIFE never runs because nothing
        //      inside the body uses its result.
        //   3. async or contains throw/return — always statement
        //      form so control flow / await reach the right scope.
        const blk = node.body
        const onlyOne =
          blk.body.length === 1 &&
          blk.body[0]!.kind !== 'LocalLet' &&
          !containsControlFlow(blk.body[0] as Expr)
        // A block that contains at least one `style { … }` rendering
        // sibling to the main vnode wants the fragment-array form
        // (`[mainVnode, styleVnode]`) — emitBlock handles that. Stay
        // on the expression-bodied path so the array shape survives.
        const hasStyleSibling = blk.body.some((e) => e.kind === 'StyleBlock')
        if (!node.async && (onlyOne || hasStyleSibling)) {
          this.emitExpr(blk)
        } else {
          this.emitLambdaStmtBody(blk)
        }
      } else if (node.async) {
        // async lambda with a non-Block body — wrap into a synthetic
        // single-item block and emit as statement-bodied. emitBlock-
        // TrailingExpr will recognize TryExpr / ThrowExpr / ReturnExpr
        // and emit them as clean JS statements (no inner IIFE), so an
        // embedded `await` doesn't end up inside a sync wrapper.
        const synth: Block = {
          kind: 'Block',
          body: [node.body],
          start: node.body.start,
          end: node.body.end,
        }
        this.emitLambdaStmtBody(synth)
      } else {
        this.emitExpr(node.body)
      }
    } finally {
      this.shadowed.pop()
    }
  }

  private emitLambdaStmtBody(node: Block): void {
    // Reuse emitBlockStatementBody — same shape, allowReturn so the
    // trailing expression escapes via `return`.
    const localNames = new Set<string>()
    for (const item of node.body) {
      if (item.kind === 'LocalLet') {
        if (item.destructureFields) {
          for (const f of item.destructureFields) localNames.add(f)
        } else {
          localNames.add(item.name)
        }
      }
    }
    if (localNames.size > 0) this.shadowed.push(localNames)
    try {
      this.emitBlockStatementBody(node, /*allowReturn*/ true)
    } finally {
      if (localNames.size > 0) this.shadowed.pop()
    }
  }

  private emitBlock(node: Block): void {
    if (node.body.length === 0) {
      this.write('(undefined)')
      return
    }
    // Local lets shadow same-named top-level cells inside this block —
    // push their names so identifier reads emit as bare idents (no .get()
    // injection). Pop in finally so style-block / multi-stmt branches all
    // honor it.
    const localNames = new Set<string>()
    for (const item of node.body) {
      if (item.kind === 'LocalLet') {
        if (item.destructureFields) {
          for (const f of item.destructureFields) localNames.add(f)
        } else {
          localNames.add(item.name)
        }
      }
    }
    if (localNames.size > 0) this.shadowed.push(localNames)
    try {
      this._emitBlockInner(node)
    } finally {
      if (localNames.size > 0) this.shadowed.pop()
    }
  }

  private _emitBlockInner(node: Block): void {
    // A block containing one or more `style { … }` blocks emits as an
    // array fragment so the renderer sees the main vnode and each style
    // vnode as siblings. LocalLet items inside such a block are still
    // ordinary const declarations; we wrap the whole thing in an IIFE
    // when needed below.
    const hasStyle = node.body.some((e) => e.kind === 'StyleBlock')
    const hasLocal = node.body.some((e) => e.kind === 'LocalLet')
    if (hasStyle && !hasLocal) {
      this.write('[')
      let first = true
      for (const item of node.body) {
        if (!first) this.write(', ')
        first = false
        this.emitExpr(item as Expr)
      }
      this.write(']')
      return
    }
    if (node.body.length === 1 && !hasLocal) {
      const only = node.body[0]
      if (!only) {
        this.write('(undefined)')
        return
      }
      this.write('(')
      this.emitExpr(only as Expr)
      this.write(')')
      return
    }
    // Multi-item path (or single-item-with-LocalLet): wrap in an IIFE.
    // LocalLet items emit as `const x = …;`; non-final expressions emit as
    // `expr;` for side effects; the FINAL non-LocalLet expression emits as
    // `return …`. If the trailing item is itself a LocalLet, the block
    // returns undefined.
    this.write('(() => {\n')
    let lastExprIdx = -1
    for (let i = node.body.length - 1; i >= 0; i--) {
      if (node.body[i]!.kind !== 'LocalLet') {
        lastExprIdx = i
        break
      }
    }
    for (let i = 0; i < node.body.length; i++) {
      const item = node.body[i]!
      this.write('  ')
      if (item.kind === 'LocalLet') {
        this.emitLocalLet(item as LocalLet)
        this.write(';\n')
      } else if (i === lastExprIdx) {
        // Inside an IIFE that mixes local-lets and a style block array
        // fragment, we still want the array shape — but only when the
        // final expression is the array fragment itself. Detect that
        // case via `hasStyle` and emit a special return shape.
        if (hasStyle) {
          this.write('return [')
          // Re-emit non-LocalLet items in source order as the array
          // fragment members. We'd already emitted the local-lets above.
          let firstArr = true
          for (const inner of node.body) {
            if (inner.kind === 'LocalLet') continue
            if (!firstArr) this.write(', ')
            firstArr = false
            this.emitExpr(inner as Expr)
          }
          this.write('];\n')
          break // we just emitted everything past the local-lets
        }
        // Trailing-position emit recognizes `throw …` / `return …` so
        // they emit as clean statements without the redundant IIFE
        // wrap that the expression-position code path uses.
        this.emitBlockTrailingExpr(item as Expr)
      } else {
        // Same statement-aware path for non-trailing items.
        this.emitBlockStmt(item as Expr)
      }
    }
    if (lastExprIdx === -1) this.write('  return undefined;\n')
    this.write('})()')
  }

  private emitLocalLet(node: LocalLet): void {
    // `let` (not `const`) so users can reassign locals inside a block
    // — `let next = null; if (x) { next = …; }` is the natural pattern
    // for early-init / late-bind variables and Tu shouldn't make it a
    // const-only language at the local scope.
    this.write('let ')
    if (node.destructureFields) {
      // M9 — TS-native object destructuring; emits `{ a, b, c }` so
      // tsserver narrows each binding from RHS's inferred shape.
      this.mark(node.nameStart, node.nameEnd, () =>
        this.write(`{ ${node.destructureFields!.join(', ')} }`)
      )
    } else {
      this.mark(node.nameStart, node.nameEnd, () => this.write(node.name))
    }
    if (this.tsMode && node.type !== undefined) {
      this.write(': ')
      if (node.typeStart !== undefined && node.typeEnd !== undefined) {
        this.mark(node.typeStart, node.typeEnd, () => this.write(node.type!))
      } else {
        this.write(node.type)
      }
    }
    this.write(' = ')
    this.emitExpr(node.value)
  }

  private emitMarkdownBlock(node: MarkdownBlock): void {
    // Render the markdown source to HTML at compile time, then emit as
    // a `$static` vnode (M6.0 path). The runtime parses the html via
    // <template>.innerHTML — no per-render allocation, no markdown
    // parser at runtime.
    //
    // We dedent the markdown body before parsing because Tu source
    // typically nests `markdown { … }` under at least one indent level
    // — markdown-it's CommonMark behaviour treats 4-space-indented
    // lines as code blocks, which would mangle every nested paragraph.
    const md = getMd()
    const html = md.render(dedent(node.source))
    const wrapped = `<article class="tu-markdown">${html}</article>`
    this.write('h(')
    this.mark(node.start, node.end, () => this.write('"$static"'))
    this.write(', {}, [], ')
    this.write(JSON.stringify(wrapped))
    this.write(')')
  }

  /**
   * `interface Foo { x: number; y: string }` (M8 / Phase 2):
   * - In TS mode, emit BOTH the `export interface Foo { … }` for tsserver
   *   AND a `export const Foo = type.struct("Foo", [...])` runtime descriptor
   *   bound to the same identifier (TS type/value namespaces are separate, so
   *   one name carries both meanings — exactly the M8 design intent).
   * - In JS mode, emit only the runtime const.
   *
   * Field type expressions are translated via `tuTypeToDescriptorExpr` —
   * primitives + arrays + nullable + nested-interface refs are mapped to
   * concrete `type.X` descriptors. Anything outside this surface (unions
   * other than `T | null`, function types, generics) falls back to
   * `type.Object` — sound but lossy until M9 generics + unions land.
   */
  /**
   * `Exception XxxError { customAttr?: string }` (M9+):
   *
   * Emits a triple-purpose identifier `XxxError`:
   *   1. TS `interface XxxError extends Error { customAttr?: string }` —
   *      drives type checking when users annotate `(): R ? XxxError`
   *      throws-clauses or catch-typed bindings.
   *   2. A callable factory function: `XxxError(message, props?)` that
   *      constructs a tagged `Error` instance with `e.name === "XxxError"`,
   *      stack-trace capture, and the user's custom fields applied.
   *   3. A native `TypeDescriptor` (M8) merged onto the function so
   *      `type.is(e, XxxError)` works alongside primitive descriptor
   *      checks. Discrimination uses `e.name === "XxxError"` (a Tu
   *      convention) which survives `instanceof` brittleness across
   *      ES module realm boundaries.
   *
   * Construction pattern is FIXED-FORM (no `new` keyword):
   *   `let err = XxxError("oops", { customAttr: "x" })`
   * Throwing flows naturally through `throw XxxError(…)`.
   */
  private emitExceptionDecl(node: ExceptionDecl): void {
    if (this.tsMode) {
      const exp = node.exported ? 'export ' : ''
      this.write(`${exp}interface `)
      this.mark(node.nameStart, node.nameEnd, () => this.write(node.name))
      this.write(' extends Error {')
      for (const f of node.fields) {
        this.write('\n  ')
        this.mark(f.nameStart, f.nameEnd, () => this.write(f.name))
        if (f.optional) this.write('?')
        this.write(': ')
        this.mark(f.typeStart, f.typeEnd, () => this.write(f.rawType.trim()))
      }
      this.write(node.fields.length > 0 ? '\n}\n' : '}\n')
    }
    // Runtime: factory function + native descriptor merged via Object.assign.
    const exp = node.exported ? 'export ' : ''
    this.write(`${exp}const `)
    this.mark(node.nameStart, node.nameEnd, () => this.write(node.name))
    if (this.tsMode) {
      // The const is callable AND carries the descriptor. Type as the
      // intersection of a factory signature + TypeDescriptor.
      const propsType = renderPropsTypeText(node.fields)
      this.write(`: ((message: string, props?: ${propsType}) => ${node.name}) & __tu_TypeDescriptor`)
    }
    // Body: build the factory + descriptor, attach descriptor fields
    // onto the function so `type.is(e, XxxError)` reaches them.
    this.write(' = (() => {\n')
    this.write(`  const factory = (message, props) => {\n`)
    this.write(`    const e = new Error(message)\n`)
    this.write(`    e.name = ${JSON.stringify(node.name)}\n`)
    if (node.fields.length > 0) {
      this.write(`    if (props) {\n`)
      for (const f of node.fields) {
        this.write(`      if (props[${JSON.stringify(f.name)}] !== undefined) `)
        this.write(`e[${JSON.stringify(f.name)}] = props[${JSON.stringify(f.name)}]\n`)
      }
      this.write(`    }\n`)
    }
    // Capture stack — `Error.captureStackTrace` is V8-only, optional
    // chain handles environments lacking it (Bun + Safari).
    this.write(`    if (Error.captureStackTrace) Error.captureStackTrace(e, factory)\n`)
    this.write(`    return e\n`)
    this.write(`  }\n`)
    // Attach M8 native descriptor so `type.is(e, XxxError)` works.
    // Function objects have read-only built-in `name` / `length`
    // properties, so `Object.assign(factory, descriptor)` would throw
    // in strict mode. Manually copy each descriptor field via
    // `Object.defineProperty` to override the built-in.
    this.write(`  const descriptor = type.native(${JSON.stringify(node.name)}, (v) => `)
    this.write(`v != null && typeof v === "object" && v.name === ${JSON.stringify(node.name)})\n`)
    this.write(`  for (const k of Object.keys(descriptor)) {\n`)
    this.write(`    Object.defineProperty(factory, k, { value: descriptor[k], writable: true, configurable: true, enumerable: true })\n`)
    this.write(`  }\n`)
    this.write(`  return factory\n`)
    this.write(`})()`)
  }

  private emitInterfaceDecl(node: InterfaceDecl): void {
    if (this.tsMode) {
      const exp = node.exported ? 'export ' : ''
      this.write(`${exp}interface `)
      this.mark(node.nameStart, node.nameEnd, () => this.write(node.name))
      this.write(' {')
      for (const f of node.fields) {
        this.write('\n  ')
        this.mark(f.nameStart, f.nameEnd, () => this.write(f.name))
        if (f.optional) this.write('?')
        this.write(': ')
        this.mark(f.typeStart, f.typeEnd, () => this.write(f.rawType.trim()))
      }
      this.write(node.fields.length > 0 ? '\n}\n' : '}\n')
    }
    // M8 Phase 6c — when the bundle orchestrator passes a canonical
    // name for THIS interface, emit an alias to the canonical descriptor
    // imported from the shared module. Otherwise (compile-only path,
    // or interface not in canonical map), emit the local descriptor as
    // Phase 2 did.
    const canonical = this.canonicalNamesForFile?.get(node.name)
    const exp = node.exported ? 'export ' : ''
    if (canonical !== undefined) {
      // The shared-module import is aliased with `__tu_canon_` prefix
      // so it never collides with the local interface name. Emit a
      // const that aliases through to the canonical (works whether or
      // not local name matches canonical).
      this.write(`${exp}const `)
      this.mark(node.nameStart, node.nameEnd, () => this.write(node.name))
      if (this.tsMode) this.write(`: __tu_TypeDescriptor`)
      this.write(` = __tu_canon_${canonical}`)
      return
    }
    // Runtime descriptor (BOTH modes — JS and TS get the const):
    this.write(`${exp}const `)
    this.mark(node.nameStart, node.nameEnd, () => this.write(node.name))
    if (this.tsMode) {
      // The const carries the runtime descriptor; the like-named TS
      // interface lives in TS's type namespace. Annotate as
      // `__tu_TypeDescriptor` so tsserver doesn't expose the descriptor's
      // internal shape (`fields`, `kind`) on user reads of `Foo`.
      this.write(`: __tu_TypeDescriptor`)
    }
    this.write(` = type.struct(${JSON.stringify(node.name)}, [`)
    for (let i = 0; i < node.fields.length; i++) {
      if (i > 0) this.write(', ')
      const f = node.fields[i]!
      this.write('{ name: ')
      this.write(JSON.stringify(f.name))
      this.write(', type: ')
      this.write(tuTypeToDescriptorExpr(f.rawType.trim(), this.typeAliasBodies, this.declaredInterfaceNames))
      if (f.optional) this.write(', optional: true')
      this.write(' }')
    }
    this.write('])')
  }

  private emitStyleBlock(node: StyleBlock): void {
    // Enforce M5/D: top-level rule selectors must be class-rooted.
    // Element selectors (`p { … }`) at top level escape the component's
    // hash scope and bleed into the page; users wanting them inside a
    // class should switch to CSS4 nesting (`.card { p { … } }`).
    const violation = findNonClassTopLevelSelector(node.css)
    if (violation !== null) {
      throw new Error(
        `top-level CSS rule must use a class selector (.foo); got "${violation}". ` +
          `Wrap element / id selectors inside a class block to use CSS nesting.`
      )
    }
    const ctx = this.currentScope()
    const css = ctx?.scoped ? rewriteCss(node.css, ctx.declared, ctx.hash) : node.css
    this.write(`h("style", {}, [${JSON.stringify(css)}])`)
  }

  private emitClassRef(node: ClassRef): void {
    const ctx = this.currentScope()
    if (!ctx) {
      throw new Error(
        `class ref .${node.name} used outside a scoped component (component must contain a style { … } block)`
      )
    }
    if (!ctx.declared.has(node.name)) {
      throw new Error(
        `class ref .${node.name} is not declared in this component's style block`
      )
    }
    // Emit BOTH the original class name AND the hashed one (space-joined),
    // so consumers can target the unhashed `.block` from global CSS / dev-
    // tools / framework theming layers, while the component's own scoped
    // styles (which use the hashed name in selectors) stay isolated.
    this.mark(node.start, node.end, () =>
      this.write(JSON.stringify(`${node.name} ${node.name}-tu-${ctx.hash}`))
    )
  }

  private currentScope(): ScopeCtx | undefined {
    return this.scopes[this.scopes.length - 1]
  }

  private emitAssignExpr(node: AssignExpr): void {
    // A lambda parameter or `for` binder shadowing the cell — plain JS assign.
    for (let i = this.shadowed.length - 1; i >= 0; i--) {
      if (this.shadowed[i]?.has(node.target)) {
        this.write('(')
        this.mark(node.targetStart, node.targetEnd, () => this.write(node.target))
        this.write(' = ')
        this.emitExpr(node.value)
        this.write(')')
        return
      }
    }
    const kind = this.cells.get(node.target)
    if (kind === 'state') {
      this.mark(node.targetStart, node.targetEnd, () => this.write(node.target))
      this.write('.set(')
      this.emitExpr(node.value)
      this.write(')')
      return
    }
    if (kind === 'computed') {
      throw new Error(`cannot assign to computed cell '${node.target}'`)
    }
    if (kind === 'function') {
      throw new Error(`cannot assign to function binding '${node.target}'`)
    }
    // Unknown binding — emit a plain JS assignment so user-defined locals work.
    this.write('(')
    this.mark(node.targetStart, node.targetEnd, () => this.write(node.target))
    this.write(' = ')
    this.emitExpr(node.value)
    this.write(')')
  }

  private emitTagCall(node: TagCall): void {
    // Static-HTML subtree optimization (M6.0). When the whole TagCall is
    // statically determinable at compile time (no cell reads, no params,
    // no event handlers, no control flow, no nested components), serialize
    // it to an HTML string here and emit a single
    // `h("$static", {}, [], "<tag>…</tag>")` call. The runtime parses the
    // template once on mount and serves it verbatim during SSR — saving an
    // h() call + props object + children array per nested vnode.
    //
    // Subtree size threshold: skip if a single tag with at most one text
    // child — the parse cost wouldn't be worth the saved allocations.
    const ctx = this.currentScope()
    if (isStaticTree(node, ctx) && countStaticNodes(node) >= 3) {
      const html = renderStaticToHtml(node, ctx)
      this.write('h(')
      this.mark(node.tagStart, node.tagEnd, () => this.write('"$static"'))
      this.write(', {}, [], ')
      this.write(JSON.stringify(html))
      this.write(')')
      return
    }
    this.write('h(')
    // Mark the tag span so a TS error on the synthetic h() call's tag
    // argument lands on the source `div` / `.foo` token.
    this.mark(node.tagStart, node.tagEnd, () => this.write(JSON.stringify(node.tag)))
    this.write(', ')
    this.emitProps(node.props)
    this.write(', ')
    this.emitChildren(node.children)
    this.write(')')
  }

  private emitCallExpr(node: CallExpr): void {
    // Use emitIdentRead so a state/computed cell holding a function
    // value (e.g. `let stop = null` later assigned a teardown thunk)
    // is unwrapped to `<name>.get()` before the call parens —
    // otherwise we'd emit `stop()` and try to invoke the cell object
    // itself. `function`-classified idents pass through bare.
    this.emitIdentRead(node.callee, node.calleeStart, node.calleeEnd)
    this.write('(')
    // M6.1 named-arg call: `Card(title: "hi", footer: …) { children }`
    // emits a single props object `Card({ title: "hi", footer: …,
    // children: [...] })`. The receiver lambda destructures the object;
    // every prop is optional by construction.
    if (node.namedArgs !== undefined) {
      this.write('{ ')
      for (let i = 0; i < node.namedArgs.length; i++) {
        if (i > 0) this.write(', ')
        const p = node.namedArgs[i]!
        this.write(`${JSON.stringify(p.name)}: `)
        this.emitExpr(p.value)
      }
      if (node.children !== undefined) {
        if (node.namedArgs.length > 0) this.write(', ')
        this.write('"children": [')
        for (let i = 0; i < node.children.length; i++) {
          if (i > 0) this.write(', ')
          this.emitExpr(node.children[i]!)
        }
        this.write(']')
      }
      this.write(' }')
      this.write(')')
      return
    }
    // Legacy positional call (M5.x BC).
    for (let i = 0; i < node.args.length; i++) {
      if (i > 0) this.write(', ')
      this.emitExpr(node.args[i]!)
    }
    // Component invocations carry a trailing children array. Emit
    // it as the last positional argument so a `let Card = (..., children)`
    // lambda can receive it.
    if (node.children !== undefined) {
      if (node.args.length > 0) this.write(', ')
      this.write('[')
      for (let i = 0; i < node.children.length; i++) {
        if (i > 0) this.write(', ')
        this.emitExpr(node.children[i]!)
      }
      this.write(']')
    }
    this.write(')')
  }

  private emitBinaryExpr(node: BinaryExpr): void {
    const op = BINARY_OP_JS[node.op]
    this.write('(')
    this.emitExpr(node.left)
    this.write(` ${op} `)
    this.emitExpr(node.right)
    this.write(')')
  }

  private emitIfExpr(node: IfExpr): void {
    this.write('(')
    this.emitExpr(node.cond)
    this.write(' ? ')
    this.emitExpr(node.then)
    this.write(' : ')
    if (node.else === undefined) this.write('undefined')
    else this.emitExpr(node.else)
    this.write(')')
  }

  private emitForExpr(node: ForExpr): void {
    this.write('Array.from(')
    this.emitExpr(node.iter)
    this.write(', (')
    this.mark(node.itemStart, node.itemEnd, () => this.write(node.item))
    this.write(') => ')
    this.shadowed.push(new Set([node.item]))
    try {
      this.emitExpr(node.body)
    } finally {
      this.shadowed.pop()
    }
    this.write(')')
  }

  private emitProps(props: Prop[]): void {
    if (props.length === 0) {
      this.write('{}')
      return
    }
    this.write('{ ')
    for (let i = 0; i < props.length; i++) {
      if (i > 0) this.write(', ')
      const p = props[i]!
      this.write(`${JSON.stringify(p.name)}: `)
      const classTypeName =
        this.tsMode && p.name === 'class' ? this.currentScope()?.classTypeName : undefined
      if (classTypeName) {
        this.write(`__tu_class<${classTypeName}>(`)
        this.emitExpr(p.value)
        this.write(')')
      } else {
        this.emitExpr(p.value)
      }
    }
    this.write(' }')
  }

  private emitChildren(children: Child[]): void {
    if (children.length === 0) {
      this.write('[]')
      return
    }
    this.write('[')
    for (let i = 0; i < children.length; i++) {
      if (i > 0) this.write(', ')
      this.emitExpr(children[i]!)
    }
    this.write(']')
  }

  /**
   * Emit an identifier read. If the name refers to a State or Computed cell
   * and is NOT shadowed by an enclosing lambda parameter, emit `.get()`. The
   * source range is recorded only for the bare ident — `.get()` is synthetic
   * and shouldn't be highlighted by diagnostics.
   */
  private emitIdentRead(name: string, srcStart: number, srcEnd: number): void {
    for (let i = this.shadowed.length - 1; i >= 0; i--) {
      if (this.shadowed[i]?.has(name)) {
        this.mark(srcStart, srcEnd, () => this.write(name))
        return
      }
    }
    const kind = this.cells.get(name)
    if (kind === 'state' || kind === 'computed') {
      this.mark(srcStart, srcEnd, () => this.write(name))
      this.write('.get()')
      return
    }
    this.mark(srcStart, srcEnd, () => this.write(name))
  }
}

// ─── AST walkers (scope analysis) ──────────────────────────────────────────

function collectClassRefs(expr: Expr | Block | undefined, out: Set<string>): void {
  if (!expr) return
  switch (expr.kind) {
    case 'ClassRef':
      out.add(expr.name)
      return
    case 'TagCall':
      for (const p of expr.props) collectClassRefs(p.value, out)
      for (const c of expr.children) collectClassRefs(c as Expr, out)
      return
    case 'CallExpr':
      for (const a of expr.args) collectClassRefs(a, out)
      if (expr.children) for (const c of expr.children) collectClassRefs(c as Expr, out)
      return
    case 'BinaryExpr':
      collectClassRefs(expr.left, out)
      collectClassRefs(expr.right, out)
      return
    case 'Block':
      for (const e of expr.body) {
        if (e.kind === 'LocalLet') collectClassRefs(e.value, out)
        else collectClassRefs(e, out)
      }
      return
    case 'IfExpr':
      collectClassRefs(expr.cond, out)
      collectClassRefs(expr.then, out)
      if (expr.else) collectClassRefs(expr.else, out)
      return
    case 'ForExpr':
      collectClassRefs(expr.iter, out)
      collectClassRefs(expr.body, out)
      return
    case 'Lambda':
      collectClassRefs(expr.body, out)
      return
    case 'AssignExpr':
      collectClassRefs(expr.value, out)
      return
    case 'MemberAssignExpr':
      collectClassRefs(expr.target, out)
      collectClassRefs(expr.value, out)
      return
    case 'InvokeExpr':
      collectClassRefs(expr.callee, out)
      for (const a of expr.args) collectClassRefs(a, out)
      return
    case 'ArrayLit':
      for (const e of expr.elements) collectClassRefs(e, out)
      return
    case 'ObjectLit':
      for (const p of expr.properties) {
        if (p.kind === 'ObjectSpread') collectClassRefs(p.arg, out)
        else {
          if (p.computedKey) collectClassRefs(p.computedKey, out)
          collectClassRefs(p.value, out)
        }
      }
      return
    case 'MemberExpr':
      collectClassRefs(expr.object, out)
      return
    case 'MethodCallExpr':
      collectClassRefs(expr.object, out)
      for (const a of expr.args) collectClassRefs(a, out)
      return
    case 'UnaryExpr':
    case 'NonNullAssertExpr':
    case 'AsExpr':
      collectClassRefs(expr.arg, out)
      return
    case 'IndexExpr':
      collectClassRefs(expr.object, out)
      collectClassRefs(expr.index, out)
      return
    case 'ThrowExpr':
      collectClassRefs(expr.arg, out)
      return
    case 'ReturnExpr':
      if (expr.value) collectClassRefs(expr.value, out)
      return
    case 'TryExpr':
      collectClassRefs(expr.body, out)
      if (expr.catchClause) collectClassRefs(expr.catchClause.body, out)
      if (expr.finallyClause) collectClassRefs(expr.finallyClause, out)
      return
    case 'TernaryExpr':
      collectClassRefs(expr.cond, out)
      collectClassRefs(expr.then, out)
      collectClassRefs(expr.else, out)
      return
    case 'NewExpr':
    case 'SpreadElement':
    case 'AwaitExpr':
    case 'ImportExpr':
      collectClassRefs(expr.arg, out)
      return
    case 'UpdateExpr':
      collectClassRefs(expr.arg, out)
      return
    case 'TemplateLit':
      for (const e of expr.expressions) collectClassRefs(e, out)
      return
    default:
      return
  }
}

function collectStyleBlockBodies(expr: Expr | Block | undefined, out: string[]): void {
  if (!expr) return
  switch (expr.kind) {
    case 'StyleBlock':
      out.push(expr.css)
      return
    case 'TagCall':
      for (const p of expr.props) collectStyleBlockBodies(p.value, out)
      for (const c of expr.children) collectStyleBlockBodies(c as Expr, out)
      return
    case 'CallExpr':
      for (const a of expr.args) collectStyleBlockBodies(a, out)
      if (expr.children) for (const c of expr.children) collectStyleBlockBodies(c as Expr, out)
      return
    case 'BinaryExpr':
      collectStyleBlockBodies(expr.left, out)
      collectStyleBlockBodies(expr.right, out)
      return
    case 'Block':
      for (const e of expr.body) {
        if (e.kind === 'LocalLet') collectStyleBlockBodies(e.value, out)
        else collectStyleBlockBodies(e, out)
      }
      return
    case 'IfExpr':
      collectStyleBlockBodies(expr.cond, out)
      collectStyleBlockBodies(expr.then, out)
      if (expr.else) collectStyleBlockBodies(expr.else, out)
      return
    case 'ForExpr':
      collectStyleBlockBodies(expr.iter, out)
      collectStyleBlockBodies(expr.body, out)
      return
    case 'Lambda':
      collectStyleBlockBodies(expr.body, out)
      return
    case 'AssignExpr':
      collectStyleBlockBodies(expr.value, out)
      return
    case 'MemberAssignExpr':
      collectStyleBlockBodies(expr.target, out)
      collectStyleBlockBodies(expr.value, out)
      return
    case 'InvokeExpr':
      collectStyleBlockBodies(expr.callee, out)
      for (const a of expr.args) collectStyleBlockBodies(a, out)
      return
    case 'ArrayLit':
      for (const e of expr.elements) collectStyleBlockBodies(e, out)
      return
    case 'ObjectLit':
      for (const p of expr.properties) {
        if (p.kind === 'ObjectSpread') collectStyleBlockBodies(p.arg, out)
        else {
          if (p.computedKey) collectStyleBlockBodies(p.computedKey, out)
          collectStyleBlockBodies(p.value, out)
        }
      }
      return
    case 'MemberExpr':
      collectStyleBlockBodies(expr.object, out)
      return
    case 'MethodCallExpr':
      collectStyleBlockBodies(expr.object, out)
      for (const a of expr.args) collectStyleBlockBodies(a, out)
      return
    case 'UnaryExpr':
    case 'NonNullAssertExpr':
    case 'AsExpr':
      collectStyleBlockBodies(expr.arg, out)
      return
    case 'IndexExpr':
      collectStyleBlockBodies(expr.object, out)
      collectStyleBlockBodies(expr.index, out)
      return
    case 'ThrowExpr':
      collectStyleBlockBodies(expr.arg, out)
      return
    case 'ReturnExpr':
      if (expr.value) collectStyleBlockBodies(expr.value, out)
      return
    case 'TryExpr':
      collectStyleBlockBodies(expr.body, out)
      if (expr.catchClause) collectStyleBlockBodies(expr.catchClause.body, out)
      if (expr.finallyClause) collectStyleBlockBodies(expr.finallyClause, out)
      return
    case 'TernaryExpr':
      collectStyleBlockBodies(expr.cond, out)
      collectStyleBlockBodies(expr.then, out)
      collectStyleBlockBodies(expr.else, out)
      return
    case 'NewExpr':
    case 'SpreadElement':
    case 'UpdateExpr':
    case 'AwaitExpr':
    case 'ImportExpr':
      collectStyleBlockBodies(expr.arg, out)
      return
    case 'TemplateLit':
      for (const e of expr.expressions) collectStyleBlockBodies(e, out)
      return
    default:
      return
  }
}

// ─── CSS class scanner + rewriter ──────────────────────────────────────────

interface ClassToken {
  start: number
  end: number
  name: string
}

const GLOBAL_PREFIX = ':global('

/**
 * Scan a CSS text for `.classname` selector tokens. Skips over `"…"` / `'…'`
 * strings, `/* … *​/` block comments, and the interior of `:global(...)`
 * escape-hatch wrappers — those classes stay unscoped at runtime, so we
 * neither register them as "declared" nor rewrite them at emit time.
 */
function scanCssClasses(css: string): ClassToken[] {
  const out: ClassToken[] = []
  let i = 0
  while (i < css.length) {
    const c = css.charAt(i)
    if (c === '/' && css.charAt(i + 1) === '*') {
      const end = css.indexOf('*/', i + 2)
      if (end < 0) break
      i = end + 2
      continue
    }
    if (c === '"' || c === "'") {
      const quote = c
      i++
      while (i < css.length && css.charAt(i) !== quote) {
        if (css.charAt(i) === '\\') i++
        i++
      }
      if (i < css.length) i++
      continue
    }
    if (css.startsWith(GLOBAL_PREFIX, i)) {
      i = skipGlobalInterior(css, i)
      continue
    }
    if (c === '.' && i + 1 < css.length && isClassFirst(css.charAt(i + 1))) {
      const start = i
      i++ // skip the dot
      while (i < css.length && isClassPart(css.charAt(i))) i++
      out.push({ start, end: i, name: css.slice(start + 1, i) })
      continue
    }
    i++
  }
  return out
}

/**
 * `i` points at the leading `:` of `:global(`. Find the matching `)` and
 * return the index of the next char to scan — past the `)`. Tracks paren
 * depth so a nested `:is(...)` inside `:global(...)` doesn't terminate
 * the wrapper early.
 */
function skipGlobalInterior(css: string, start: number): number {
  let depth = 1
  let j = start + GLOBAL_PREFIX.length
  while (j < css.length && depth > 0) {
    const cc = css.charAt(j)
    if (cc === '(') depth++
    else if (cc === ')') depth--
    if (depth === 0) break
    j++
  }
  return j + 1 // past the matching `)`
}

function isClassFirst(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === '-'
}

function isClassPart(c: string): boolean {
  return isClassFirst(c) || (c >= '0' && c <= '9')
}

function findCssClasses(css: string): Set<string> {
  const out = new Set<string>()
  for (const tok of scanCssClasses(css)) out.add(tok.name)
  return out
}

/**
 * Rewrite `.declaredClass` selectors in `css` to `.declaredClass-tu-{hash}`.
 * Class names not in `declared` are left untouched (referring to global CSS).
 *
 * Also strips `:global(...)` wrappers from the output: the wrapper itself is
 * dropped while the contents pass through verbatim. Combined with the
 * scanner skipping global interiors, this gives the user an explicit
 * escape hatch for an otherwise-scoped selector.
 */
function rewriteCss(css: string, declared: Set<string>, hash: string): string {
  let out = ''
  let i = 0
  while (i < css.length) {
    const c = css.charAt(i)
    if (c === '/' && css.charAt(i + 1) === '*') {
      const end = css.indexOf('*/', i + 2)
      if (end < 0) {
        out += css.slice(i)
        break
      }
      out += css.slice(i, end + 2)
      i = end + 2
      continue
    }
    if (c === '"' || c === "'") {
      const quote = c
      const start = i
      i++
      while (i < css.length && css.charAt(i) !== quote) {
        if (css.charAt(i) === '\\') i++
        i++
      }
      if (i < css.length) i++
      out += css.slice(start, i)
      continue
    }
    if (css.startsWith(GLOBAL_PREFIX, i)) {
      // Strip the wrapper — emit the inner body as-is. Nested classes are
      // intentionally left unscoped (that's what :global means).
      const innerStart = i + GLOBAL_PREFIX.length
      const wrapperEnd = skipGlobalInterior(css, i)
      out += css.slice(innerStart, wrapperEnd - 1) // exclude the trailing `)`
      i = wrapperEnd
      continue
    }
    if (c === '.' && i + 1 < css.length && isClassFirst(css.charAt(i + 1))) {
      const start = i
      i++ // skip dot
      while (i < css.length && isClassPart(css.charAt(i))) i++
      const name = css.slice(start + 1, i)
      out += '.' + name
      if (declared.has(name)) out += `-tu-${hash}`
      continue
    }
    out += c
    i++
  }
  return out
}

/**
 * Walk the CSS body's top-level rules. A rule's "selector" is whatever
 * sits between the previous depth-0 `}` (or start) and the next `{`.
 * Comma-split each, trim, and check each piece starts with `.` (class
 * selector), `:global(` (escape hatch), or `@` (at-rule like `@media`).
 *
 * Returns the first offending selector text on violation, or `null` when
 * every top-level rule is class-rooted.
 *
 * Skips strings, comments, and `:global(...)` wrappers' interiors so a
 * `.foo > p` inside a global escape doesn't flag.
 */
function findNonClassTopLevelSelector(css: string): string | null {
  let buffer = ''
  let depth = 0
  let i = 0
  while (i < css.length) {
    const c = css.charAt(i)
    if (c === '/' && css.charAt(i + 1) === '*') {
      const end = css.indexOf('*/', i + 2)
      if (end < 0) break
      i = end + 2
      continue
    }
    if (c === '"' || c === "'") {
      const q = c
      i++
      while (i < css.length && css.charAt(i) !== q) {
        if (css.charAt(i) === '\\') i++
        i++
      }
      if (i < css.length) i++
      continue
    }
    if (c === '{') {
      if (depth === 0) {
        const v = checkSelectorList(buffer)
        if (v !== null) return v
        buffer = ''
      }
      depth++
      i++
      continue
    }
    if (c === '}') {
      depth--
      if (depth === 0) buffer = ''
      i++
      continue
    }
    if (depth === 0) buffer += c
    i++
  }
  return null
}

function checkSelectorList(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  // Comma-split. Doesn't fully respect parens (`:not(.a, .b)`), good
  // enough for V1 — common CSS rarely has commas inside top-level
  // pseudo-class args.
  const parts = trimmed.split(',').map((p) => p.trim()).filter(Boolean)
  for (const p of parts) {
    if (p.startsWith('.')) continue
    if (p.startsWith(':global(')) continue
    if (p.startsWith('@')) continue
    return p
  }
  return null
}

// ─── Static-HTML subtree optimization (M6.0) ───────────────────────────────
//
// When a TagCall subtree is fully statically determinable (no cell reads,
// no lambda params, no event handlers, no control flow, no nested
// components), the codegen serializes it to an HTML string at compile
// time and emits a single `h("$static", {}, [], html)` call. The runtime
// parses the template once on mount and reuses the resulting DOM root.
//
// Bounds (V1 MVP):
//   - Subtree must be a single TagCall as its root.
//   - All props must be literal (StringLit / NumberLit / true / declared
//     ClassRef). No cell-driven props, no event handlers (`on*`).
//   - Children must each be: StringLit, NumberLit, declared ClassRef, or
//     another static TagCall recursively. No idents (cell reads), no
//     calls, no if/for, no Lambda/Block/AssignExpr/ObjectLit/MemberExpr.
//   - Tag must NOT be `style` or `script` — raw-text elements have
//     different escape rules; the existing `emitStyleBlock` path already
//     handles `style { ... }` specially.
//
// ClassRef hashes are baked in here using the same dual-class output as
// `emitClassRef` (M5/F dual-class injection), so scoped CSS keeps lining
// up with the static markup.

const STATIC_VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'source', 'track', 'wbr',
])

/** True iff the expression's runtime shape is fully known at compile time. */
function isStaticTree(expr: Expr | Child, scope: ScopeCtx | undefined): boolean {
  if (expr.kind === 'StringLit') return true
  if (expr.kind === 'NumberLit') return true
  if (expr.kind === 'ClassRef') {
    return scope !== undefined && scope.declared.has(expr.name)
  }
  if (expr.kind === 'TagCall') {
    if (expr.tag === 'style' || expr.tag === 'script') return false
    for (const p of expr.props) {
      if (isEventPropName(p.name)) return false
      if (!isStaticPropValue(p.value, scope)) return false
    }
    for (const c of expr.children) {
      if (!isStaticTree(c as Expr, scope)) return false
    }
    return true
  }
  return false
}

function isStaticPropValue(v: Expr, scope: ScopeCtx | undefined): boolean {
  if (v.kind === 'StringLit') return true
  if (v.kind === 'NumberLit') return true
  if (v.kind === 'ClassRef') {
    return scope !== undefined && scope.declared.has(v.name)
  }
  return false
}

function isEventPropName(name: string): boolean {
  if (name.length < 3) return false
  if (name.charAt(0) !== 'o' || name.charAt(1) !== 'n') return false
  const c = name.charCodeAt(2)
  return c >= 0x41 && c <= 0x5a // capital letter
}

/** Count tag/text/classref nodes in a static subtree — used for the
 *  "skip tiny optimizations" threshold. */
function countStaticNodes(expr: Expr | Child): number {
  if (expr.kind === 'TagCall') {
    let n = 1
    for (const c of expr.children) n += countStaticNodes(c as Expr)
    return n
  }
  return 1
}

/**
 * Serialize a known-static subtree to an HTML string. Mirror of
 * `renderVNode` from `@tu-lang/runtime`, but operating on AST nodes instead of
 * VNodes. Uses the same escape rules so the output round-trips through
 * `renderToString` without double-escaping.
 */
function renderStaticToHtml(expr: Expr | Child, scope: ScopeCtx | undefined): string {
  if (expr.kind === 'StringLit') return escapeStaticText(expr.value)
  if (expr.kind === 'NumberLit') return String(expr.value)
  if (expr.kind === 'ClassRef') {
    if (!scope) return escapeStaticText(expr.name)
    return escapeStaticText(`${expr.name} ${expr.name}-tu-${scope.hash}`)
  }
  if (expr.kind === 'TagCall') {
    let propStr = ''
    for (const p of expr.props) {
      const rendered = renderStaticPropValue(p.value, scope)
      if (rendered === null) continue // boolean false / null prop — drop
      if (rendered === '') {
        propStr += ` ${p.name}` // boolean true → bare attribute
      } else {
        propStr += ` ${p.name}="${escapeStaticAttr(rendered)}"`
      }
    }
    if (STATIC_VOID_ELEMENTS.has(expr.tag)) {
      return `<${expr.tag}${propStr}>`
    }
    let childStr = ''
    for (const c of expr.children) {
      childStr += renderStaticToHtml(c as Expr, scope)
    }
    return `<${expr.tag}${propStr}>${childStr}</${expr.tag}>`
  }
  // Should never reach — isStaticTree gates the kinds we accept.
  return ''
}

/** Returns the prop value as a string (escapable), or `null` to drop the
 *  prop entirely (false / null / undefined values), or `''` for a boolean
 *  `true` (emit as a bare attribute). */
function renderStaticPropValue(v: Expr, scope: ScopeCtx | undefined): string | null {
  if (v.kind === 'StringLit') return v.value
  if (v.kind === 'NumberLit') return String(v.value)
  if (v.kind === 'ClassRef') {
    if (!scope) return v.name
    return `${v.name} ${v.name}-tu-${scope.hash}`
  }
  return null
}

/** Recursive check: does `expr` contain a `throw` or `return` that
 *  would need to escape the surrounding lambda? Used by emitLambda to
 *  decide between expression-bodied and statement-bodied forms.
 *  Crosses into if-branches and try-catch arms (which may sit at
 *  statement positions inside the lambda); does **NOT** cross into
 *  nested Lambdas — those have their own return semantics. */
function containsControlFlow(expr: Expr): boolean {
  switch (expr.kind) {
    case 'ThrowExpr':
    case 'ReturnExpr':
      return true
    case 'IfExpr':
      if (containsControlFlow(expr.cond)) return true
      if (blockHasControlFlow(expr.then)) return true
      if (expr.else !== undefined) {
        if (expr.else.kind === 'IfExpr') return containsControlFlow(expr.else)
        if (blockHasControlFlow(expr.else)) return true
      }
      return false
    case 'TryExpr':
      if (blockHasControlFlow(expr.body)) return true
      if (expr.catchClause && blockHasControlFlow(expr.catchClause.body)) return true
      if (expr.finallyClause && blockHasControlFlow(expr.finallyClause)) return true
      return false
    case 'Block':
      return blockHasControlFlow(expr)
    case 'BinaryExpr':
      return containsControlFlow(expr.left) || containsControlFlow(expr.right)
    case 'UnaryExpr':
    case 'NonNullAssertExpr':
    case 'AsExpr':
      return containsControlFlow(expr.arg)
    case 'AssignExpr':
      return containsControlFlow(expr.value)
    case 'MemberAssignExpr':
      return containsControlFlow(expr.target) || containsControlFlow(expr.value)
    case 'InvokeExpr':
      return containsControlFlow(expr.callee) || expr.args.some(containsControlFlow)
    case 'CallExpr':
      return expr.args.some(containsControlFlow)
    case 'MethodCallExpr':
      return containsControlFlow(expr.object) || expr.args.some(containsControlFlow)
    case 'MemberExpr':
      return containsControlFlow(expr.object)
    case 'IndexExpr':
      return containsControlFlow(expr.object) || containsControlFlow(expr.index)
    case 'ArrayLit':
      return expr.elements.some(containsControlFlow)
    case 'ObjectLit':
      return expr.properties.some((p) =>
        p.kind === 'ObjectSpread'
          ? containsControlFlow(p.arg)
          : (p.computedKey ? containsControlFlow(p.computedKey) : false) || containsControlFlow(p.value)
      )
    case 'TernaryExpr':
      return containsControlFlow(expr.cond) || containsControlFlow(expr.then) || containsControlFlow(expr.else)
    case 'NewExpr':
    case 'SpreadElement':
    case 'UpdateExpr':
    case 'AwaitExpr':
    case 'ImportExpr':
      return containsControlFlow(expr.arg)
    case 'TemplateLit':
      return expr.expressions.some(containsControlFlow)
    default:
      return false
  }
}

function blockHasControlFlow(b: Block): boolean {
  for (const item of b.body) {
    if (item.kind === 'LocalLet') {
      if (containsControlFlow(item.value)) return true
      continue
    }
    if (containsControlFlow(item as Expr)) return true
  }
  return false
}

/** Re-escape a decoded template-literal chunk so it round-trips through
 *  a JS template literal: `\``, `\$`, `\\` and the `${` opener. */
function escapeTemplateChunk(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i)
    if (c === '`') out += '\\`'
    else if (c === '\\') out += '\\\\'
    else if (c === '$' && s.charAt(i + 1) === '{') {
      out += '\\${'
      i++ // skip the `{` we just emitted
    } else {
      out += c
    }
  }
  return out
}

function escapeStaticText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeStaticAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

// ─── Markdown dedent (M6.3) ────────────────────────────────────────────────

/**
 * Strip the common leading-whitespace prefix from every non-blank line
 * of a multi-line string. Used by `markdown { … }` block emit so users
 * can indent the markdown body to match surrounding Tu code without
 * tripping CommonMark's "4-space-indent = code block" rule.
 *
 * Tabs are treated as 1 column for prefix calculation — same as
 * markdown-it's tokenizer treats them. Edge case: an entirely-blank
 * input returns empty string.
 */
function dedent(source: string): string {
  const lines = source.split('\n')
  let minIndent = Infinity
  for (const line of lines) {
    if (line.trim() === '') continue
    const m = line.match(/^[ \t]*/)
    const len = m ? m[0].length : 0
    if (len < minIndent) minIndent = len
  }
  if (!isFinite(minIndent) || minIndent === 0) return source
  return lines.map((l) => (l.length >= minIndent ? l.slice(minIndent) : l)).join('\n')
}

// ─── Hash ───────────────────────────────────────────────────────────────────

/** FNV-1a 32-bit, returned as the leading 6 hex digits. */
function fnv1a6(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 6)
}

// ─── Source map (V3) ───────────────────────────────────────────────────────

const VLQ_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function encodeVLQ(n: number): string {
  let v = n < 0 ? ((-n) << 1) | 1 : n << 1
  let out = ''
  do {
    let digit = v & 0b11111
    v >>>= 5
    if (v > 0) digit |= 0b100000
    out += VLQ_CHARS.charAt(digit)
  } while (v > 0)
  return out
}

/**
 * Build a V3 source map from the per-statement and per-token mapping anchors.
 * Token mappings are folded in as additional segments (start position only —
 * V3 has no native end-of-segment representation; the LSP consumes the
 * richer `tokenMappings` list directly for diagnostic-range translation).
 */
function buildV3Map(
  stmtMappings: StmtMapping[],
  tokenMappings: TokenMapping[],
  generated: string,
  source: string,
  filename: string
): SourceMapV3 {
  const totalGenLines = generated === '' ? 0 : generated.split('\n').length
  // Group all mappings by generated line. Both stmt anchors and token spans
  // contribute one segment each (token spans use their start position).
  const byLine = new Map<number, { genCol: number; srcLine: number; srcCol: number }[]>()
  const push = (jsOffset: number, srcOffset: number) => {
    const gen = lineColAt(generated, jsOffset)
    const src = lineColAt(source, srcOffset)
    const list = byLine.get(gen.line - 1) ?? []
    list.push({ genCol: gen.col - 1, srcLine: src.line - 1, srcCol: src.col - 1 })
    byLine.set(gen.line - 1, list)
  }
  for (const m of stmtMappings) push(m.jsOffset, m.srcOffset)
  for (const t of tokenMappings) push(t.jsStart, t.srcStart)
  // VLQ-encode segments line-by-line. genCol resets each line; srcLine/srcCol
  // are relative across the whole map.
  const out: string[] = []
  let prevSrcLine = 0
  let prevSrcCol = 0
  for (let line = 0; line < totalGenLines; line++) {
    const segs = byLine.get(line) ?? []
    segs.sort((a, b) => a.genCol - b.genCol)
    let prevGenCol = 0
    const segStrs: string[] = []
    for (const seg of segs) {
      let s = ''
      s += encodeVLQ(seg.genCol - prevGenCol)
      s += encodeVLQ(0) // sources index (we only ever have one source)
      s += encodeVLQ(seg.srcLine - prevSrcLine)
      s += encodeVLQ(seg.srcCol - prevSrcCol)
      segStrs.push(s)
      prevGenCol = seg.genCol
      prevSrcLine = seg.srcLine
      prevSrcCol = seg.srcCol
    }
    out.push(segStrs.join(','))
  }
  return {
    version: 3,
    file: filename,
    sources: [filename],
    sourcesContent: [source],
    names: [],
    mappings: out.join(';'),
  }
}

/** Base64-encode a UTF-8 string. Works in Node (Buffer) and the browser (btoa). */
function base64Encode(s: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(s, 'utf8').toString('base64')
  }
  // Browser fallback — `btoa` only handles bytes in 0x00..0xFF, so we
  // funnel UTF-8 bytes through a Latin-1 string first.
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}
