import { createRequire } from 'node:module'
import * as vscode from 'vscode'
import {
  LanguageClient,
  TransportKind,
  type LanguageClientOptions,
  type ServerOptions,
} from 'vscode-languageclient/node.js'

export { EXTENSION_NAME, VERSION } from './meta.js'

let client: LanguageClient | undefined

/**
 * Activated by VS Code when a `.tu` file is opened (`onLanguage:tu` in the
 * extension manifest). Spawns the @tu/lsp diagnostics server and routes
 * .tu documents through it.
 */
export function activate(context: vscode.ExtensionContext): void {
  // Resolve the @tu/lsp server entry by walking up node_modules from this
  // extension. createRequire gives us regular CommonJS resolution semantics.
  const requireFromHere = createRequire(import.meta.url)
  let serverModule: string
  try {
    serverModule = requireFromHere.resolve('@tu/lsp/server')
  } catch (err) {
    void vscode.window.showErrorMessage(
      `vscode-tu: could not locate @tu/lsp server (${err instanceof Error ? err.message : String(err)})`
    )
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
  }

  client = new LanguageClient('tu', 'Tu language server', serverOptions, clientOptions)
  context.subscriptions.push({
    dispose: () => {
      void client?.stop()
      client = undefined
    },
  })
  void client.start()
}

export function deactivate(): Promise<void> | undefined {
  if (!client) return undefined
  return client.stop()
}
