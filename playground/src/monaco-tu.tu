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
    "let", "export", "import", "from", "as", "if", "else", "for", "of", "in",
    "computed", "effect", "watch", "async", "await",
    "where", "order", "by", "take", "skip", "server", "client", "stream", "defer",
    "try", "catch", "finally", "throw", "return", "new", "external",
  ]
  const CONSTANTS = ["true", "false", "null", "undefined"]
  const TYPE_PRIMITIVES = [
    "string", "number", "boolean", "void", "any", "unknown", "never", "object",
    "Child", "VNode", "Event",
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
        [/"([^"\\]|\\.)*$/, "string.invalid"],
        [/"/, { token: "string.quote", next: "@string" }],
        [/\b\d+(\.\d+)?\b/, "number"],
        [/\.([a-zA-Z_][\w-]*)/, "entity.other.attribute-name"],
        [/\b([a-z][\w]*)(?=\s*:)/, "attribute.name"],
        [/\b[A-Z][\w]*\b/, "type.identifier"],
        [/\b([a-z][\w]*)(?=\s*[\(\{])/, "tag"],
        [/\b[a-zA-Z_]\w*\b/, {
          cases: {
            "@keywords": "keyword.control",
            "@constants": "constant.language",
            "@typePrimitives": "type",
            "@default": "identifier",
          },
        }],
        [/=>|==|!=|<=|>=|\|\||&&|\?\?|\?\.|[+\-*/%!<>=?]/, "operator"],
        [/[{}()\[\]]/, "@brackets"],
        [/[,;:.]/, "delimiter"],
      ],
      string: [
        [/[^"\\]+/, "string"],
        [/\\(n|t|r|"|\\)/, "constant.character.escape"],
        [/"/, { token: "string.quote", next: "@pop" }],
      ],
      styleEnter: [[/\{/, { token: "delimiter.curly", next: "@styleBody" }]],
      styleBody: [
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
          next: "@externalBody",
          nextEmbedded: "javascript",
        }],
        [/\s+/, "white"],
      ],
      externalHeadTs: [
        [/\(/, { token: "delimiter.parenthesis", next: "@externalParams" }],
        [/:/, { token: "delimiter", next: "@externalReturnType" }],
        [/\{/, {
          token: "delimiter.curly",
          next: "@externalBody",
          nextEmbedded: "typescript",
        }],
        [/\s+/, "white"],
      ],
      externalParams: [
        [/\)/, { token: "delimiter.parenthesis", next: "@pop" }],
        [/[a-zA-Z_]\w*/, "identifier"],
        [/:/, "delimiter"],
        [/[\w<>,\[\]\s]+/, "type"],
        [/,/, "delimiter"],
      ],
      externalReturnType: [
        [/\{/, { token: "@rematch", next: "@pop" }],
        [/[\w<>,\[\]\s]+/, "type"],
      ],
      externalBody: [
        [/\}/, {
          token: "delimiter.curly",
          next: "@pop",
          nextEmbedded: "@pop",
        }],
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
      { token: "constant.language", foreground: "fb923c" },
      { token: "string", foreground: "86efac" },
      { token: "string.quote", foreground: "86efac" },
      { token: "string.markdown", foreground: "86efac" },
      { token: "constant.character.escape", foreground: "fde68a" },
      { token: "number", foreground: "fb923c" },
      { token: "type", foreground: "7dd3fc" },
      { token: "type.identifier", foreground: "fde68a" },
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
let registerTuLangServices = external JS (monaco: any): void {
  const TU_KEYWORDS = [
    "let", "export", "import", "from", "as", "if", "else", "for", "of", "in",
    "computed", "async", "await", "try", "catch", "finally", "throw", "return",
    "new", "external", "type",
  ]
  const TU_CONSTANTS = ["true", "false", "null", "undefined"]
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
      insertText: 'try {\n  $1\n} catch (e) {\n  $0\n}',
      docs: "Try expression — catch clause yields fallback value.",
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
  // Lightweight regex-based scan for top-level `let`/`export let`/`type`
  // declarations. Skips comments + strings; tracks brace depth to keep
  // top-level only. Faster than full Tu parse + good enough for hover
  // and symbol completion.
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
      // Look for top-level `let`/`export let`/`type` at depth 0.
      if (depth === 0 && /[a-z]/.test(ch)) {
        const rest = src.slice(i)
        let m = rest.match(/^export\s+let\s+([A-Za-z_$][\w$]*)/)
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
        m = rest.match(/^export\s+type\s+([A-Za-z_$][\w$]*)/)
        if (m) {
          decls.push({ kind: "type", exported: true, name: m[1], line, col, offset: i, len: m[0].length })
          i += m[0].length
          continue
        }
        m = rest.match(/^type\s+([A-Za-z_$][\w$]*)/)
        if (m) {
          decls.push({ kind: "type", exported: false, name: m[1], line, col, offset: i, len: m[0].length })
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
      // Snippets.
      for (const s of SNIPPETS) {
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
      // Keywords.
      for (const k of TU_KEYWORDS) {
        suggestions.push({ label: k, kind: CompletionItemKind.Keyword, insertText: k, range })
      }
      // Constants.
      for (const c of TU_CONSTANTS) {
        suggestions.push({ label: c, kind: CompletionItemKind.Constant, insertText: c, range })
      }
      // HTML tags.
      for (const tag of HTML_TAGS) {
        suggestions.push({
          label: tag,
          kind: CompletionItemKind.Class,
          detail: "HTML element",
          insertText: tag + " { $0 }",
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
        })
      }
      // Symbols from THIS file + every other open model in the workspace
      // (so cross-file `let X` in another tab shows up here too).
      const allModels = monaco.editor.getModels()
      const seen = new Set()
      for (const m of allModels) {
        if (m.getLanguageId() !== "tu") continue
        for (const d of parseModel(m)) {
          if (seen.has(d.name)) continue
          seen.add(d.name)
          const isCurrent = m === model
          suggestions.push({
            label: d.name,
            kind: d.kind === "type" ? CompletionItemKind.TypeParameter : CompletionItemKind.Variable,
            detail: d.kind === "type"
              ? (d.exported ? "exported type" : "type")
              : (d.exported ? "exported binding" : "binding") + (isCurrent ? "" : ` (${m.uri.path})`),
            insertText: d.name,
            range,
          })
        }
      }
      return { suggestions }
    },
  })

  monaco.languages.registerHoverProvider("tu", {
    provideHover(model, position) {
      const word = model.getWordAtPosition(position)
      if (!word) return null
      // Search this model first, then peers.
      const models = [model, ...monaco.editor.getModels().filter((m) => m !== model && m.getLanguageId() === "tu")]
      for (const m of models) {
        const decl = parseModel(m).find((d) => d.name === word.word)
        if (decl) {
          const where = m === model ? "" : ` (in ${m.uri.path})`
          const text = snippetText(m, decl)
          return {
            contents: [
              { value: `**${word.word}**${where}` },
              { value: "```tu\n" + text.trim() + "\n```" },
            ],
          }
        }
      }
      return null
    },
  })

  monaco.languages.registerDefinitionProvider("tu", {
    provideDefinition(model, position) {
      const word = model.getWordAtPosition(position)
      if (!word) return null
      for (const m of monaco.editor.getModels()) {
        if (m.getLanguageId() !== "tu") continue
        const decl = parseModel(m).find((d) => d.name === word.word)
        if (decl) {
          const ln = lineForOffset(m.getValue(), decl.offset)
          // The decl's `offset` is the start of `let`/`export let`; jump
          // to the column of the name (offset by `let ` keyword).
          const before = m.getValue().slice(decl.offset, decl.offset + decl.len)
          const nameStart = decl.offset + before.lastIndexOf(decl.name)
          const lineStart = m.getValue().lastIndexOf("\n", nameStart - 1) + 1
          const colStart = nameStart - lineStart + 1
          return {
            uri: m.uri,
            range: {
              startLineNumber: ln,
              startColumn: colStart,
              endLineNumber: ln,
              endColumn: colStart + decl.name.length,
            },
          }
        }
      }
      return null
    },
  })

  // Reference provider — find every occurrence of the symbol name in
  // any Tu model. Word-boundary regex; skips comments + strings.
  monaco.languages.registerReferenceProvider("tu", {
    provideReferences(model, position) {
      const word = model.getWordAtPosition(position)
      if (!word) return []
      const refs = []
      const re = new RegExp(`\\b${word.word.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "g")
      for (const m of monaco.editor.getModels()) {
        if (m.getLanguageId() !== "tu") continue
        const src = m.getValue()
        let match
        while ((match = re.exec(src)) !== null) {
          // Skip if inside a // comment.
          const lineStart = src.lastIndexOf("\n", match.index - 1) + 1
          const linePrefix = src.slice(lineStart, match.index)
          if (linePrefix.includes("//")) continue
          const ln = lineForOffset(src, match.index)
          const col = match.index - lineStart + 1
          refs.push({
            uri: m.uri,
            range: {
              startLineNumber: ln,
              startColumn: col,
              endLineNumber: ln,
              endColumn: col + word.word.length,
            },
          })
        }
      }
      return refs
    },
  })
}

let _registerServices = registerTuLangServices(monaco)

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
