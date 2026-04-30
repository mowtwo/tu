#!/usr/bin/env node
import { TextDocument } from 'vscode-languageserver-textdocument'
import {
  createConnection,
  Diagnostic,
  DiagnosticSeverity,
  ProposedFeatures,
  Range,
  TextDocuments,
  TextDocumentSyncKind,
  type DiagnosticRelatedInformation,
} from 'vscode-languageserver/node.js'
import { fileURLToPath } from 'node:url'
import { checkTuSource, type TuDiagnostic } from './diagnostics.js'

const connection = createConnection(ProposedFeatures.all)
const documents = new TextDocuments(TextDocument)

connection.onInitialize(() => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Incremental,
  },
  serverInfo: {
    name: '@tu/lsp',
    version: '0.0.0',
  },
}))

const SEVERITY_MAP: Record<TuDiagnostic['severity'], DiagnosticSeverity> = {
  error: DiagnosticSeverity.Error,
  warning: DiagnosticSeverity.Warning,
  hint: DiagnosticSeverity.Hint,
  info: DiagnosticSeverity.Information,
}

function toLspDiagnostic(d: TuDiagnostic, documentText: string): Diagnostic {
  // V1 source maps are per top-level statement, so we land on column 0 of
  // the offending `let` line. Highlight from there up to the `=` (or the
  // end of the line if no `=`) so the squiggle covers the binding header
  // — `export let bad1` — and clearly identifies which binding is broken
  // without dragging across the whole multi-line body. Token-level ranges
  // are V2 work.
  const start = { line: d.line, character: d.col }
  const end = { line: d.line, character: lineEndForRange(documentText, d.line, d.col) }
  const range: Range = { start, end }
  return {
    severity: SEVERITY_MAP[d.severity],
    range,
    message: d.message,
    source: '@tu/lsp',
    code: d.code === -1 ? undefined : d.code,
  } satisfies Diagnostic
}

/**
 * Compute the end column for a per-statement diagnostic squiggle. Looks at
 * the source text of the line containing the error and returns the column
 * of the first `=` that appears after `startCol`, or the end of the line if
 * no `=` is found. Falls back to `startCol + 1` (single character) for
 * defensive corner cases.
 */
function lineEndForRange(documentText: string, line: number, startCol: number): number {
  const lines = documentText.split('\n')
  const lineText = lines[line]
  if (lineText === undefined) return startCol + 1
  // Look for the first `=` at or after startCol. Prefer ending right BEFORE
  // it so the squiggle covers `export let bad1 ` rather than including `=`.
  const eqIdx = lineText.indexOf('=', startCol)
  if (eqIdx > startCol) {
    // Trim a trailing space so the squiggle ends on the binding name itself.
    let end = eqIdx
    while (end > startCol && /\s/.test(lineText.charAt(end - 1))) end--
    return Math.max(end, startCol + 1)
  }
  // No `=` on this line — squiggle the rest of the line.
  return Math.max(lineText.length, startCol + 1)
}

const debounceTimers = new Map<string, NodeJS.Timeout>()
const DEBOUNCE_MS = 250

function scheduleCheck(uri: string): void {
  const prev = debounceTimers.get(uri)
  if (prev) clearTimeout(prev)
  const timer = setTimeout(() => {
    debounceTimers.delete(uri)
    runCheck(uri)
  }, DEBOUNCE_MS)
  debounceTimers.set(uri, timer)
}

function runCheck(uri: string): void {
  const doc = documents.get(uri)
  if (!doc) return
  const filename = uri.startsWith('file://') ? fileURLToPath(uri) : uri
  let diagnostics: Diagnostic[]
  const documentText = doc.getText()
  try {
    const tuDiags = checkTuSource(documentText, filename)
    diagnostics = tuDiags.map((d) => toLspDiagnostic(d, documentText))
  } catch (err) {
    // Defensive: never crash the server. Surface unexpected errors as a
    // single diagnostic at the top of the file so the user sees something.
    diagnostics = [
      {
        severity: DiagnosticSeverity.Error,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        message: `@tu/lsp internal error: ${err instanceof Error ? err.message : String(err)}`,
        source: '@tu/lsp',
      },
    ]
  }
  void connection.sendDiagnostics({ uri, diagnostics })
}

documents.onDidOpen((e) => scheduleCheck(e.document.uri))
documents.onDidChangeContent((e) => scheduleCheck(e.document.uri))
documents.onDidSave((e) => runCheck(e.document.uri))
documents.onDidClose((e) => {
  const t = debounceTimers.get(e.document.uri)
  if (t) clearTimeout(t)
  debounceTimers.delete(e.document.uri)
  // Clear stale diagnostics for closed documents.
  void connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] })
})

documents.listen(connection)
connection.listen()

// Re-export for type-safe testing
export type { DiagnosticRelatedInformation }
