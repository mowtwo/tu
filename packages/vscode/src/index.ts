import * as vscode from 'vscode'
import {
  LanguageClient,
  TransportKind,
  type LanguageClientOptions,
  type ServerOptions,
} from 'vscode-languageclient/node'

export { EXTENSION_NAME, VERSION } from './meta'

let client: LanguageClient | undefined
let log: vscode.OutputChannel | undefined

/**
 * Activated by VS Code when a `.tu` file is opened (`onLanguage:tu` in the
 * extension manifest). Spawns the @tu/lsp diagnostics server and routes
 * .tu documents through it.
 *
 * Every step writes to the "Tu (vscode-tu)" output channel so it's obvious
 * what activated, what failed, and why. `Cmd+Shift+P → Output: Show Output
 * Channels…` and pick that channel.
 */
export function activate(context: vscode.ExtensionContext): void {
  log = vscode.window.createOutputChannel('Tu (vscode-tu)')
  context.subscriptions.push(log)
  log.appendLine(`vscode-tu activate() — extension path: ${context.extensionPath}`)

  // Resolve the @tu/lsp server entry by walking up node_modules from this
  // extension. We're in CJS, so `require.resolve` is available globally.
  let serverModule: string
  try {
    serverModule = require.resolve('@tu/lsp/server')
    log.appendLine(`  resolved @tu/lsp/server → ${serverModule}`)
  } catch (err) {
    const msg = `vscode-tu: could not locate @tu/lsp server (${err instanceof Error ? err.message : String(err)})`
    log.appendLine(`  ERROR: ${msg}`)
    void vscode.window.showErrorMessage(msg)
    return
  }

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ['--nolazy', '--inspect=6009'] },
    },
  }

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'tu' }],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*.tu'),
    },
    outputChannel: log,
  }

  client = new LanguageClient('tu', 'Tu language server', serverOptions, clientOptions)
  context.subscriptions.push({
    dispose: () => {
      void client?.stop()
      client = undefined
    },
  })
  log.appendLine('  starting language client…')
  client.start().then(
    () => {
      log?.appendLine('  language client started OK')
    },
    (err: unknown) => {
      const msg = err instanceof Error ? err.stack ?? err.message : String(err)
      log?.appendLine(`  ERROR starting language client:\n${msg}`)
      void vscode.window.showErrorMessage(`vscode-tu: language client failed to start. See "Tu (vscode-tu)" output for details.`)
    }
  )
}

export function deactivate(): Promise<void> | undefined {
  if (!client) return undefined
  return client.stop()
}
