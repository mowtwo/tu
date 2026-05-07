// Monaco editor binding for Tu source — registered once at module load.
//
// We use Monaco's monarch tokenizer (a simple regex-state DFA) rather
// than wiring up the full TextMate grammar via vscode-textmate +
// onigasm. The trade is ~1 MB of WASM dependencies vs. maintaining
// two grammar definitions; for an in-browser playground that's the
// right call. The set of tokens here mirrors `packages/vscode/syntaxes/
// tu.tmLanguage.json` closely enough that highlighting matches what
// the VS Code extension shows.
//
// We also import only the editor's main API entry plus the editor
// worker — none of the language workers (typescript, css, json, html)
// are needed for Tu.
//
// The monarch and theme configs are dense JS data structures (lots of
// regex literals, `@` reference strings, deeply nested objects), so
// the `registerTuLanguage` / `defineTuTheme` registrations below sit
// inside `external JS` blocks. The Tu surface stays focused on the
// imports + the `createTuEditor` / `setCompileError` API surface.

import * as monaco from "monaco-editor/esm/vs/editor/editor.api"
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker"
import { tokenize, TokenKind } from "@tu-lang/compiler"
import {
  completionsAtTuBrowserPosition,
  definitionAtTuBrowserPosition,
  diagnosticsAtTuBrowserFile,
  hoverAtTuBrowserPosition,
  referencesAtTuBrowserPosition,
} from "@tu-lang/lsp/browser"
// Basic-languages contributions register JS / TS / CSS / HTML token
// providers (for syntax highlighting only — no type checking, no LSP).
// We need them so the read-only JS / .d.ts views in the live editor
// have proper highlighting; the editor.api entry alone ships no
// language tokenizers besides what we register manually.
// Tu doesn't yet support bare `import "…"` side-effect imports, so we
// pull these as namespace bindings the bundler will tree-shake into
// the same side-effect form. (Vite + the contribution modules: each
// registers a language with monaco at module-load time.)
import * as _basicJs from "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution"
import * as _basicTs from "monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution"
import * as _basicCss from "monaco-editor/esm/vs/basic-languages/css/css.contribution"

let installWorker = external JS (EditorWorker: any) {
  self.MonacoEnvironment = { getWorker: () => new EditorWorker() }
}

let _wireWorker = installWorker(EditorWorker)

let registerTuLanguage = external JS (monaco: any) {
  const KEYWORDS = [
    "let", "export", "default", "import", "from", "as",
    "interface", "type", "enum", "Exception",
    "if", "else", "for", "of", "in",
    "computed", "effect", "watch", "async", "await",
    "where", "order", "by", "take", "skip", "server", "client", "stream", "defer",
    "try", "catch", "finally", "throw", "return", "new", "external", "style", "markdown",
  ]
  const CONSTANTS = ["true", "false", "null"]
  const TYPE_PRIMITIVES = [
    "string", "number", "boolean", "void", "any", "unknown", "never",
    "null", "undefined", "object", "bigint", "symbol",
    "Child", "VNode", "Event", "Promise", "RegExp", "Error",
  ]
  monaco.languages.register({ id: "tu", extensions: [".tu"], aliases: ["Tu"] })
  monaco.languages.setMonarchTokensProvider("tu", {
    defaultToken: "",
    tokenPostfix: ".tu",
    keywords: KEYWORDS,
    constants: CONSTANTS,
    typePrimitives: TYPE_PRIMITIVES,
    brackets: [
      { open: "{", close: "}", token: "delimiter.curly" },
      { open: "(", close: ")", token: "delimiter.parenthesis" },
      { open: "[", close: "]", token: "delimiter.square" },
    ],
    tokenizer: {
      root: [
        [/\/\/.*$/, "comment"],
        // `external <Lang> [(params)] [: returnType] { raw body }` —
        // the body is verbatim source in the tagged language, so we
        // delegate tokenization to the embedded language. JS / TS get
        // their basic-language tokenizers automatically.
        [/\bexternal\s+JS\b/, { token: "keyword.control", next: "@externalHead" }],
        [/\bexternal\s+TS\b/, { token: "keyword.control", next: "@externalHeadTs" }],
        [/\bstyle\b(?=\s*\{)/, { token: "keyword.control", next: "@styleEnter" }],
        [/\bmarkdown\b(?=\s*\{)/, { token: "keyword.control", next: "@markdownEnter" }],
        [/\b(interface|type|enum|Exception)\s+([A-Z_$][\w$]*)/, ["keyword.control", "type.identifier"]],
        [/\b(export)\s+(default)\s+(let)\s+([A-Za-z_$][\w$]*)/, ["keyword.control", "keyword.control", "keyword.control", "identifier"]],
        [/\b(export)\s+(let)\s+([A-Za-z_$][\w$]*)/, ["keyword.control", "keyword.control", "identifier"]],
        [/\b(let)\s+([A-Za-z_$][\w$]*)/, ["keyword.control", "identifier"]],
        [/"([^"\\]|\\.)*$/, "string.invalid"],
        [/"/, { token: "string.quote", next: "@string" }],
        [/'([^'\\]|\\.)*$/, "string.invalid"],
        [/'/, { token: "string.quote", next: "@stringSingle" }],
        [/`/, { token: "string.quote", next: "@templateString" }],
        [/\/(?:\\.|[^\n\/\\])+\/[dgimsuvy]*/, "regexp"],
        [/\b\d+(\.\d+)?\b/, "number"],
        [/\.([a-zA-Z_][\w-]*)/, "entity.other.attribute-name"],
        [/\b([a-z][\w]*)(?=\s*:)/, "attribute.name"],
        [/\b([A-Z][\w]*)(?=\s*[\(\{])/, "type.component"],
        [/\b([a-z][\w]*)(?=\s*[\(\{])/, "tag"],
        [/\b[A-Z][\w]*\b/, "type.identifier"],
        [/\b[a-zA-Z_]\w*\b/, {
          cases: {
            "@keywords": "keyword.control",
            "@constants": "constant.language",
            "@typePrimitives": "type",
            "@default": "identifier",
          },
        }],
        [/=>|\*\*=|\*\*|\?\?|\?\.|\.{3}|\.{2}|&&|\|\||==|!=|<=|>=|<<|>>|[+\-*/%=&|^~!<>?:]=?/, "operator"],
        [/[{}()\[\]]/, "@brackets"],
        [/[,;:.]/, "delimiter"],
      ],
      string: [
        [/[^"\\]+/, "string"],
        [/\\(n|t|r|"|\\)/, "constant.character.escape"],
        [/"/, { token: "string.quote", next: "@pop" }],
      ],
      stringSingle: [
        [/[^'\\]+/, "string"],
        [/\\(n|t|r|'|\\)/, "constant.character.escape"],
        [/'/, { token: "string.quote", next: "@pop" }],
      ],
      templateString: [
        [/[^`\\$]+/, "string"],
        [/\\(`|\$|n|t|r|\\)/, "constant.character.escape"],
        [/\$\{/, { token: "delimiter.bracket", next: "@templateExpr" }],
        [/`/, { token: "string.quote", next: "@pop" }],
      ],
      templateExpr: [
        [/\}/, { token: "delimiter.bracket", next: "@pop" }],
        { include: "root" },
      ],
      styleEnter: [[/\{/, { token: "delimiter.curly", next: "@styleBodyRoot" }]],
      styleBodyRoot: [
        [/\{/, { token: "delimiter.curly", next: "@styleBodyNested" }],
        [/\}/, { token: "delimiter.curly", next: "@pop" }],
        [/\/\/.*$/, "comment"],
        [/\/\*/, { token: "comment", next: "@cssBlockComment" }],
        [/(--[\w-]+)/, "variable.css"],
        [/[.#&][\w-]+/, "entity.other.attribute-name.css"],
        [/[a-zA-Z-]+(?=\s*:)/, "attribute.name.css"],
        [/"([^"\\]|\\.)*"/, "string"],
        [/\b\d+(\.\d+)?(px|em|rem|%|vh|vw|fr|s|ms|deg)?\b/, "number"],
        [/[{}]/, "@brackets"],
        [/[(),;:]/, "delimiter"],
      ],
      styleBodyNested: [
        [/\{/, { token: "delimiter.curly", next: "@styleBodyNested" }],
        [/\}/, { token: "delimiter.curly", next: "@pop" }],
        [/\/\/.*$/, "comment"],
        [/\/\*/, { token: "comment", next: "@cssBlockComment" }],
        [/(--[\w-]+)/, "variable.css"],
        [/[.#&][\w-]+/, "entity.other.attribute-name.css"],
        [/[a-zA-Z-]+(?=\s*:)/, "attribute.name.css"],
        [/"([^"\\]|\\.)*"/, "string"],
        [/\b\d+(\.\d+)?(px|em|rem|%|vh|vw|fr|s|ms|deg)?\b/, "number"],
        [/[{}]/, "@brackets"],
        [/[(),;:]/, "delimiter"],
      ],
      cssBlockComment: [
        [/[^*]+/, "comment"],
        [/\*\//, { token: "comment", next: "@pop" }],
        [/[*]/, "comment"],
      ],
      markdownEnter: [[/\{/, { token: "delimiter.curly", next: "@markdownBody" }]],
      markdownBody: [
        [/\}/, { token: "delimiter.curly", next: "@pop" }],
        [/^#{1,6}\s.+$/, "keyword.markdown"],
        [/`[^`\n]*`/, "string.markdown"],
        [/\*\*[^*\n]+\*\*/, "strong.markdown"],
        [/\*[^*\n]+\*/, "emphasis.markdown"],
        [/[^}`*#]+/, "text.markdown"],
        [/./, "text.markdown"],
      ],
      // `external JS (params) [: T] { raw JS }` — head accepts an
      // optional param list, optional return type, then `{` which
      // pushes us into the embedded JS tokenizer.
      externalHead: [
        [/\(/, { token: "delimiter.parenthesis", next: "@externalParams" }],
        [/:/, { token: "delimiter", next: "@externalReturnType" }],
        [/\{/, {
          token: "delimiter.curly",
          next: "@externalBodyRoot",
          nextEmbedded: "javascript",
        }],
        [/\s+/, "white"],
      ],
      externalHeadTs: [
        [/\(/, { token: "delimiter.parenthesis", next: "@externalParams" }],
        [/:/, { token: "delimiter", next: "@externalReturnType" }],
        [/\{/, {
          token: "delimiter.curly",
          next: "@externalBodyRootTs",
          nextEmbedded: "typescript",
        }],
        [/\s+/, "white"],
      ],
      externalParams: [
        [/\)/, { token: "delimiter.parenthesis", next: "@pop" }],
        [/[a-zA-Z_]\w*/, "identifier"],
        [/:/, "delimiter"],
        [/[{}]/, "@brackets"],
        [/[\w.$<>,\[\]\s|&?:;'"()-]+/, "type"],
        [/,/, "delimiter"],
      ],
      externalReturnType: [
        [/\{[^{}]*\}/, "type"],
        [/\{/, { token: "@rematch", next: "@pop" }],
        [/[\w.$<>,\[\]\s|&?:;'"()-]+/, "type"],
      ],
      externalBodyRoot: [
        [/\{/, { token: "delimiter.curly", next: "@externalBodyNested" }],
        [/\}/, {
          token: "delimiter.curly",
          next: "@pop",
          nextEmbedded: "@pop",
        }],
      ],
      externalBodyNested: [
        [/\{/, { token: "delimiter.curly", next: "@externalBodyNested" }],
        [/\}/, { token: "delimiter.curly", next: "@pop" }],
      ],
      externalBodyRootTs: [
        [/\{/, { token: "delimiter.curly", next: "@externalBodyNestedTs" }],
        [/\}/, {
          token: "delimiter.curly",
          next: "@pop",
          nextEmbedded: "@pop",
        }],
      ],
      externalBodyNestedTs: [
        [/\{/, { token: "delimiter.curly", next: "@externalBodyNestedTs" }],
        [/\}/, { token: "delimiter.curly", next: "@pop" }],
      ],
    },
  })
}

let defineTuTheme = external JS (monaco: any) {
  monaco.editor.defineTheme("tu-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6b7280", fontStyle: "italic" },
      { token: "keyword.control", foreground: "c084fc", fontStyle: "bold" },
      { token: "keyword", foreground: "c084fc", fontStyle: "bold" },
      { token: "constant.language", foreground: "fb923c" },
      { token: "string", foreground: "86efac" },
      { token: "string.quote", foreground: "86efac" },
      { token: "string.markdown", foreground: "86efac" },
      { token: "constant.character.escape", foreground: "fde68a" },
      { token: "number", foreground: "fb923c" },
      { token: "type", foreground: "7dd3fc" },
      { token: "class", foreground: "c4b5fd" },
      { token: "variable", foreground: "e2e8f0" },
      { token: "property", foreground: "93c5fd" },
      { token: "type.identifier", foreground: "fde68a" },
      { token: "type.component", foreground: "c4b5fd" },
      { token: "regexp", foreground: "fca5a5" },
      { token: "tag", foreground: "60a5fa" },
      { token: "attribute.name", foreground: "93c5fd" },
      { token: "entity.other.attribute-name", foreground: "fbbf24" },
      { token: "operator", foreground: "d4d4d8" },
      { token: "delimiter", foreground: "d4d4d8" },
      { token: "identifier", foreground: "e2e8f0" },
      { token: "variable.css", foreground: "93c5fd" },
      { token: "attribute.name.css", foreground: "93c5fd" },
      { token: "entity.other.attribute-name.css", foreground: "fbbf24" },
      { token: "keyword.markdown", foreground: "c084fc", fontStyle: "bold" },
      { token: "strong.markdown", fontStyle: "bold" },
      { token: "emphasis.markdown", fontStyle: "italic" },
      { token: "text.markdown", foreground: "e2e8f0" },
    ],
    colors: {
      "editor.background": "#0f172a",
      "editor.foreground": "#e2e8f0",
      "editorLineNumber.foreground": "#475569",
      "editorLineNumber.activeForeground": "#94a3b8",
      "editor.selectionBackground": "#334155",
      "editor.lineHighlightBackground": "#1e293b80",
      "editorCursor.foreground": "#a78bfa",
      "editorIndentGuide.background1": "#1e293b",
      "editorIndentGuide.activeBackground1": "#334155",
    },
  })
}

let _registerLang = registerTuLanguage(monaco)
let _registerTheme = defineTuTheme(monaco)

let registerTuSemanticTokens = external JS (monaco: any, tokenize: any, TokenKind: any): void {
  const tokenTypes = [
    "keyword", "variable", "type", "class", "property",
    "string", "number", "regexp", "comment", "operator",
  ]
  const legend = { tokenTypes, tokenModifiers: [] }
  const keywordKinds = new Set([
    TokenKind.Let, TokenKind.Export, TokenKind.Import, TokenKind.From,
    TokenKind.If, TokenKind.Else, TokenKind.For, TokenKind.In,
    TokenKind.Try, TokenKind.Catch, TokenKind.Finally, TokenKind.Throw,
    TokenKind.Return, TokenKind.Async, TokenKind.Await, TokenKind.External,
    TokenKind.New,
  ])
  const typeWords = new Set([
    "string", "number", "boolean", "void", "unknown", "never",
    "object", "bigint", "symbol", "Child", "VNode", "Event",
    "Promise", "RegExp", "Error",
  ])
  const constants = new Set(["true", "false", "null"])
  function typeIndex(name) { return tokenTypes.indexOf(name) }
  function lineStarts(src) {
    const starts = [0]
    for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) starts.push(i + 1)
    return starts
  }
  function lineCol(starts, offset) {
    let lo = 0, hi = starts.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (starts[mid] <= offset) lo = mid + 1
      else hi = mid - 1
    }
    const line = Math.max(0, lo - 1)
    return { line, col: offset - starts[line] }
  }
  monaco.languages.registerDocumentSemanticTokensProvider("tu", {
    getLegend: () => legend,
    provideDocumentSemanticTokens(model) {
      const src = model.getValue()
      let toks
      try { toks = tokenize(src, model.uri.path) } catch { return { data: new Uint32Array(0) } }
      const starts = lineStarts(src)
      const rows = []
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i]
        if (t.kind === TokenKind.Eof || t.end <= t.start) continue
        let typ = null
        if (keywordKinds.has(t.kind)) typ = "keyword"
        else if (t.kind === TokenKind.Ident) {
          if (constants.has(t.text)) typ = "keyword"
          else if (typeWords.has(t.text)) typ = "type"
          else if (/^[A-Z]/.test(t.text)) typ = "type"
          else typ = "variable"
        } else if (t.kind === TokenKind.String || t.kind === TokenKind.TemplateChunk || t.kind === TokenKind.Backtick) typ = "string"
        else if (t.kind === TokenKind.Number) typ = "number"
        else if (t.kind === TokenKind.Regex) typ = "regexp"
        else if (
          t.kind === TokenKind.Plus || t.kind === TokenKind.Minus || t.kind === TokenKind.Star ||
          t.kind === TokenKind.StarStar || t.kind === TokenKind.Slash || t.kind === TokenKind.Percent ||
          t.kind === TokenKind.EqEq || t.kind === TokenKind.NotEq || t.kind === TokenKind.Gt ||
          t.kind === TokenKind.Lt || t.kind === TokenKind.GtEq || t.kind === TokenKind.LtEq ||
          t.kind === TokenKind.OrOr || t.kind === TokenKind.AndAnd || t.kind === TokenKind.QuestionQuestion ||
          t.kind === TokenKind.QuestionDot || t.kind === TokenKind.FatArrow
        ) typ = "operator"
        if (!typ) continue
        const start = lineCol(starts, t.start)
        const end = lineCol(starts, t.end)
        if (start.line !== end.line) continue
        rows.push([start.line, start.col, Math.max(1, t.end - t.start), typeIndex(typ), 0])
      }
      rows.sort((a, b) => a[0] - b[0] || a[1] - b[1])
      const data = []
      let lastLine = 0
      let lastCol = 0
      for (const row of rows) {
        const lineDelta = row[0] - lastLine
        const colDelta = lineDelta === 0 ? row[1] - lastCol : row[1]
        data.push(lineDelta, colDelta, row[2], row[3], row[4])
        lastLine = row[0]
        lastCol = row[1]
      }
      return { data: new Uint32Array(data) }
    },
    releaseDocumentSemanticTokens: () => {},
  })
}
let _registerSemanticTokens = registerTuSemanticTokens(monaco, tokenize, TokenKind)

// Stash the monaco namespace globally so peer .tu modules (live-demo)
// can spawn read-only editors / models without re-importing it (Tu
// doesn't yet have a clean way to share a namespace import between
// modules at the value level).
let _stashMonaco = external JS (monaco: any): void {
  globalThis.__tuMonaco = monaco
}
let _stashed = _stashMonaco(monaco)

// Snippet completion + symbol completion + hover + go-to-definition.
// All runs in-browser using @tu-lang/compiler's parser — no LSP, no
// typescript. Provides:
//   - Keyword + HTML-tag + common-pattern snippets
//   - Symbols declared anywhere in the workspace's open models
//     (`let X = …`, `export let X`, `type X`)
//   - Hover showing the source of any declaration we can find
//   - Go-to-definition jumps to the first matching `let X` in any model
let registerTuLangServices = external JS (
  monaco: any,
  hoverAtTuBrowserPosition: any,
  completionsAtTuBrowserPosition: any,
  definitionAtTuBrowserPosition: any,
  referencesAtTuBrowserPosition: any,
): void {
  const TU_KEYWORDS = [
    "let", "export", "default", "import", "from", "as",
    "interface", "type", "enum", "Exception",
    "if", "else", "for", "of", "in",
    "computed", "async", "await", "try", "catch", "finally", "throw", "return",
    "new", "external", "style", "markdown",
  ]
  const TU_CONSTANTS = ["true", "false", "null"]
  const HTML_TAGS = [
    "div", "span", "p", "h1", "h2", "h3", "h4", "h5", "h6",
    "a", "button", "input", "textarea", "select", "option", "form", "label",
    "ul", "ol", "li", "table", "tr", "td", "th", "thead", "tbody",
    "section", "article", "header", "footer", "nav", "main", "aside",
    "img", "video", "audio", "iframe", "canvas",
    "code", "pre", "strong", "em", "br", "hr",
  ]
  const SNIPPETS = [
    {
      label: "App",
      detail: "exported component",
      insertText: 'export let App = () => div {\n  $0\n}',
      docs: "Top-level component for live editor.",
    },
    {
      label: "component",
      detail: "named component",
      insertText: 'export let ${1:Name} = (props) => div {\n  $0\n}',
      docs: "Reusable component with props parameter.",
    },
    {
      label: "default component",
      detail: "default export",
      insertText: 'export default let ${1:App} = () => div {\n  $0\n}',
      docs: "Default-exported component.",
    },
    {
      label: "interface",
      detail: "object shape",
      insertText: 'interface ${1:Name} {\n  ${2:field}: ${3:string}\n}',
      docs: "Named structural object shape.",
    },
    {
      label: "enum",
      detail: "enum declaration",
      insertText: 'enum ${1:Name} {\n  ${2:Value}\n}',
      docs: "Runtime enum with a matching type.",
    },
    {
      label: "Exception",
      detail: "structured exception",
      insertText: 'Exception ${1:AppError} {\n  ${2:code}?: ${3:string}\n}',
      docs: "Tagged Error shape for throws/catch flows.",
    },
    {
      label: "cell",
      detail: "reactive state cell",
      insertText: 'let ${1:count} = ${2:0}',
      docs: "Auto-wrapped in Signal.State; `${1} = …` mutates it.",
    },
    {
      label: "computed",
      detail: "derived cell",
      insertText: 'let ${1:doubled} = computed(${2:count} * 2)',
      docs: "Derived cell that re-evaluates when its inputs change.",
    },
    {
      label: "if",
      detail: "if expression",
      insertText: 'if (${1:cond}) {\n  $0\n} else {\n  \n}',
      docs: "Tu's if is an expression — branches yield values.",
    },
    {
      label: "for",
      detail: "for-in loop",
      insertText: 'for ${1:item} in ${2:items} {\n  $0\n}',
      docs: "Iterates a collection; yields an array of vnodes.",
    },
    {
      label: "try",
      detail: "try/catch",
      insertText: 'try {\n  $1\n} catch ${2:e} {\n  $0\n}',
      docs: "Try expression — catch binding defaults to Error.",
    },
    {
      label: "catch if",
      detail: "filtered catch",
      insertText: 'catch if ${1:ValidationError} as ${2:e} {\n  $0\n}',
      docs: "Catch only errors matching a runtime type descriptor.",
    },
    {
      label: "style",
      detail: "scoped style block",
      insertText: 'style {\n  .${1:className} {\n    $0\n  }\n}',
      docs: "Per-component scoped CSS; class names are auto-hashed.",
    },
    {
      label: "async",
      detail: "async function",
      insertText: 'async (${1:args}) => {\n  $0\n}',
      docs: "Async lambda; can use await inside.",
    },
    {
      label: "await",
      detail: "await expression",
      insertText: 'await ${0}',
      docs: "Await a Promise inside an async lambda.",
    },
    {
      label: "external JS",
      detail: "raw JS escape hatch",
      insertText: 'external JS (${1:args}): ${2:any} {\n  $0\n}',
      docs: "Drop into raw JavaScript for browser-API interop.",
    },
    {
      label: "fetch",
      detail: "async fetch + json",
      insertText: 'async (url) => {\n  let r = await fetch(url)\n  $0\n  return r.json()\n}',
      docs: "Common fetch pattern.",
    },
  ]
  const CompletionItemKind = monaco.languages.CompletionItemKind

  // Cache parser results per model+version so hover/completion don't
  // re-parse on every keystroke.
  const parseCache = new WeakMap()
  function parseModel(model) {
    const v = model.getVersionId()
    const cached = parseCache.get(model)
    if (cached && cached.v === v) return cached.result
    const result = scanDeclarations(model.getValue())
    parseCache.set(model, { v, result })
    return result
  }
  // Lightweight regex-based scan for top-level value/type declarations.
  // Skips comments + strings; tracks brace depth to keep top-level only.
  // Faster than full Tu parse + good enough for hover and symbol completion.
  function scanDeclarations(src) {
    const decls = []
    let i = 0
    let line = 1
    let col = 1
    let depth = 0
    while (i < src.length) {
      const ch = src.charAt(i)
      if (ch === "\n") { line++; col = 1; i++; continue }
      // Skip line comments.
      if (ch === "/" && src.charAt(i + 1) === "/") {
        while (i < src.length && src.charAt(i) !== "\n") { i++; col++ }
        continue
      }
      // Skip strings (any quote style).
      if (ch === '"' || ch === "'" || ch === "`") {
        const q = ch; i++; col++
        while (i < src.length && src.charAt(i) !== q) {
          if (src.charAt(i) === "\\") { i++; col++ }
          if (i < src.length) { if (src.charAt(i) === "\n") { line++; col = 1 } else { col++ } i++ }
        }
        if (i < src.length) { i++; col++ }
        continue
      }
      // Track depth.
      if (ch === "{" || ch === "(" || ch === "[") { depth++; i++; col++; continue }
      if (ch === "}" || ch === ")" || ch === "]") { depth--; i++; col++; continue }
      // Look for top-level value/type declarations at depth 0.
      if (depth === 0 && /[A-Za-z]/.test(ch)) {
        const rest = src.slice(i)
        let m = rest.match(/^export\s+default\s+let\s+([A-Za-z_$][\w$]*)/)
        if (m) {
          decls.push({ kind: "let", exported: true, name: m[1], line, col, offset: i, len: m[0].length })
          i += m[0].length
          continue
        }
        m = rest.match(/^export\s+let\s+([A-Za-z_$][\w$]*)/)
        if (m) {
          decls.push({ kind: "let", exported: true, name: m[1], line, col, offset: i, len: m[0].length })
          i += m[0].length
          continue
        }
        m = rest.match(/^let\s+([A-Za-z_$][\w$]*)/)
        if (m) {
          decls.push({ kind: "let", exported: false, name: m[1], line, col, offset: i, len: m[0].length })
          i += m[0].length
          continue
        }
        m = rest.match(/^export\s+(type|interface|enum|Exception)\s+([A-Za-z_$][\w$]*)/)
        if (m) {
          decls.push({ kind: "type", exported: true, name: m[2], line, col, offset: i, len: m[0].length })
          i += m[0].length
          continue
        }
        m = rest.match(/^(type|interface|enum|Exception)\s+([A-Za-z_$][\w$]*)/)
        if (m) {
          decls.push({ kind: "type", exported: false, name: m[2], line, col, offset: i, len: m[0].length })
          i += m[0].length
          continue
        }
      }
      i++; col++
    }
    return decls
  }

  function lineForOffset(src, off) {
    const upto = src.slice(0, off)
    return upto.split("\n").length
  }
  function snippetText(model, decl) {
    const src = model.getValue()
    const lineStart = src.lastIndexOf("\n", decl.offset - 1) + 1
    const lineEnd = src.indexOf("\n", decl.offset)
    return src.slice(lineStart, lineEnd === -1 ? src.length : lineEnd)
  }

  function workspaceFiles() {
    return monaco.editor.getModels()
      .filter((m) => m.getLanguageId() === "tu")
      .map((m) => ({ path: m.uri.path, source: m.getValue() }))
  }
  function monacoRange(loc) {
    return {
      startLineNumber: loc.line + 1,
      startColumn: loc.col + 1,
      endLineNumber: loc.line + 1,
      endColumn: loc.col + 1 + Math.max(1, loc.length),
    }
  }
  function completionKind(kind) {
    switch (kind) {
      case "keyword": return CompletionItemKind.Keyword
      case "const": return CompletionItemKind.Constant
      case "var": return CompletionItemKind.Variable
      case "let": return CompletionItemKind.Variable
      case "function": return CompletionItemKind.Function
      case "method": return CompletionItemKind.Method
      case "property": return CompletionItemKind.Property
      case "class": return CompletionItemKind.Class
      case "interface": return CompletionItemKind.Interface
      case "type": return CompletionItemKind.TypeParameter
      case "enum": return CompletionItemKind.Enum
      default: return CompletionItemKind.Text
    }
  }

  monaco.languages.registerCompletionItemProvider("tu", {
    triggerCharacters: [".", " ", "<"],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      }
      const suggestions = []
      const lspItems = completionsAtTuBrowserPosition(
        workspaceFiles(),
        model.uri.path,
        position.lineNumber - 1,
        position.column - 1,
      )
      const seen = new Set()
      for (const item of lspItems) {
        seen.add(item.label)
        suggestions.push({
          label: item.label,
          kind: completionKind(item.kind),
          insertText: item.insertText ?? item.label,
          detail: item.detail,
          documentation: item.documentation,
          sortText: item.sortText,
          range,
        })
      }
      // Snippets.
      for (const s of SNIPPETS) {
        if (seen.has(s.label)) continue
        suggestions.push({
          label: s.label,
          kind: CompletionItemKind.Snippet,
          insertText: s.insertText,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: s.detail,
          documentation: s.docs,
          range,
        })
      }
      // Keywords/snippets remain UI sugar; symbol/type knowledge comes
      // from the shared browser LSP above.
      for (const k of TU_KEYWORDS) {
        if (seen.has(k)) continue
        suggestions.push({ label: k, kind: CompletionItemKind.Keyword, insertText: k, range })
      }
      // Constants.
      for (const c of TU_CONSTANTS) {
        if (seen.has(c)) continue
        suggestions.push({ label: c, kind: CompletionItemKind.Constant, insertText: c, range })
      }
      // HTML tags.
      for (const tag of HTML_TAGS) {
        if (seen.has(tag)) continue
        suggestions.push({
          label: tag,
          kind: CompletionItemKind.Class,
          detail: "HTML element",
          insertText: tag + " { $0 }",
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
        })
      }
      return { suggestions }
    },
  })

  monaco.languages.registerHoverProvider("tu", {
    provideHover(model, position) {
      const info = hoverAtTuBrowserPosition(
        workspaceFiles(),
        model.uri.path,
        position.lineNumber - 1,
        position.column - 1,
      )
      if (!info) return null
      const contents = [{ value: "```typescript\n" + info.contents + "\n```" }]
      if (info.documentation) contents.push({ value: info.documentation })
      return { contents, range: monacoRange(info) }
    },
  })

  monaco.languages.registerDefinitionProvider("tu", {
    provideDefinition(model, position) {
      const defs = definitionAtTuBrowserPosition(
        workspaceFiles(),
        model.uri.path,
        position.lineNumber - 1,
        position.column - 1,
      )
      return defs.map((d) => ({ uri: monaco.Uri.parse(d.uri), range: monacoRange(d) }))
    },
  })

  monaco.languages.registerReferenceProvider("tu", {
    provideReferences(model, position) {
      return referencesAtTuBrowserPosition(
        workspaceFiles(),
        model.uri.path,
        position.lineNumber - 1,
        position.column - 1,
        true,
      ).map((r) => ({ uri: monaco.Uri.parse(r.uri), range: monacoRange(r) }))
    },
  })
}

let _registerServices = registerTuLangServices(
  monaco,
  hoverAtTuBrowserPosition,
  completionsAtTuBrowserPosition,
  definitionAtTuBrowserPosition,
  referencesAtTuBrowserPosition,
)

// Mount a Tu-flavored Monaco editor into `host`. Returns the editor
// instance plus a teardown that disposes the editor + its model. The
// caller wires up `onDidChangeModelContent` for the recompile pipeline.
export let createTuEditor = (host: HTMLElement, initialValue: string) => {
  let editor = monaco.editor.create(host, {
    value: initialValue,
    language: "tu",
    theme: "tu-dark",
    automaticLayout: true,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 13,
    lineNumbers: "on",
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    renderWhitespace: "selection",
    tabSize: 2,
    insertSpaces: true,
    bracketPairColorization: { enabled: true },
    "semanticHighlighting.enabled": true,
    guides: { indentation: true, bracketPairs: true },
    smoothScrolling: true,
    cursorSmoothCaretAnimation: "on",
    padding: { top: 12, bottom: 12 },
    wordWrap: "on",
  })
  let dispose = () => {
    editor.getModel()?.dispose()
    editor.dispose()
  }
  return { editor: editor, dispose: dispose }
}

// Highlight a Tu compile error inside the editor by setting a model
// marker at the offending source position. Tu's `compile` throws with
// a message like `unexpected token X\n  at line N, col M\n…`; this
// regex grabs the first such span. If the regex doesn't match
// (defensive fallback), we mark the first line so users still see
// *something* go red.
export let setCompileError = external JS (editor: unknown, message: string): void {
  const model = editor.getModel()
  if (!model) return
  const m = /at line (\d+), col (\d+)/.exec(message)
  const line = m ? Number(m[1]) : 1
  const col = m ? Number(m[2]) : 1
  monaco.editor.setModelMarkers(model, "tu-compile", [{
    severity: monaco.MarkerSeverity.Error,
    startLineNumber: line,
    startColumn: col,
    endLineNumber: line,
    endColumn: col + 1,
    message: message,
    source: "tu",
  }])
}

export let clearCompileErrors = external JS (editor: unknown): void {
  const model = editor.getModel()
  if (!model) return
  monaco.editor.setModelMarkers(model, "tu-compile", [])
}

// Create one Monaco model per file in a case. Disposes any pre-existing
// model at the same URI so re-entering a case doesn't trip Monaco's
// "model already exists" guard. Returns a `Map<path, ITextModel>`.
export let createWorkspaceModels = external JS (caseDef: unknown): unknown {
  const models = new Map()
  caseDef.files.forEach((file) => {
    const uri = monaco.Uri.parse("tu:/" + caseDef.id + "/" + file.path)
    const existing = monaco.editor.getModel(uri)
    if (existing) existing.dispose()
    const model = monaco.editor.createModel(file.content, "tu", uri)
    models.set(file.path, model)
  })
  return models
}

// Set a per-file compile error marker, given a (line, col) tuple
// instead of just a message. Used by the live demo's multi-file
// pipeline so an error in `Card.tu` lights up `Card.tu` (not the
// active file).
export let setCompileErrorOn = external JS (model: unknown, message: string, line: number, col: number): void {
  monaco.editor.setModelMarkers(model, "tu-compile", [{
    severity: monaco.MarkerSeverity.Error,
    startLineNumber: line,
    startColumn: col,
    endLineNumber: line,
    endColumn: col + 1,
    message: message,
    source: "tu",
  }])
}

export let clearCompileErrorsOn = external JS (model: unknown): void {
  monaco.editor.setModelMarkers(model, "tu-compile", [])
}

export let refreshTuLspDiagnostics = external JS (models: unknown): void {
  if (!models) return
  const files = []
  models.forEach((model) => {
    files.push({ path: model.uri.path, source: model.getValue() })
  })
  models.forEach((model) => {
    const diags = diagnosticsAtTuBrowserFile(files, model.uri.path)
    monaco.editor.setModelMarkers(model, "tu-lsp", diags.map((d) => {
      const severity =
        d.severity === "error"
          ? monaco.MarkerSeverity.Error
          : d.severity === "warning"
            ? monaco.MarkerSeverity.Warning
            : d.severity === "hint"
              ? monaco.MarkerSeverity.Hint
              : monaco.MarkerSeverity.Info
      return {
        severity,
        startLineNumber: d.line + 1,
        startColumn: d.col + 1,
        endLineNumber: d.line + 1,
        endColumn: d.col + 1 + Math.max(1, d.length),
        message: d.message,
        code: d.code >= 0 ? String(d.code) : undefined,
        source: "tu-lsp",
      }
    }))
  })
}
