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
export let setCompileError = (editor: any, message: string) => {
  let model = editor.getModel()
  if (!model) { return }
  let m = /at line (\d+), col (\d+)/.exec(message)
  let line = m ? Number(m[1]) : 1
  let col = m ? Number(m[2]) : 1
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

export let clearCompileErrors = (editor: any) => {
  let model = editor.getModel()
  if (!model) { return }
  monaco.editor.setModelMarkers(model, "tu-compile", [])
}
