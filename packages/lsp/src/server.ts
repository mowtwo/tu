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

function toLspDiagnostic(d: TuDiagnostic): Diagnostic {
  // V1 source-map granularity is per-statement, so the .tu position points
  // at the start of the offending statement. Highlight a 1-character range
  // — VS Code renders this as a squiggle on that single column. Real
  // token-level ranges land in V2.
  const start = { line: d.line, character: d.col }
  const end = { line: d.line, character: d.col + 1 }
  const range: Range = { start, end }
  return {
    severity: SEVERITY_MAP[d.severity],
    range,
    message: d.message,
    source: '@tu/lsp',
    code: d.code === -1 ? undefined : d.code,
  } satisfies Diagnostic
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
  try {
    const tuDiags = checkTuSource(doc.getText(), filename)
    diagnostics = tuDiags.map(toLspDiagnostic)
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
