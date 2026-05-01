// Live editor — multi-file Tu workspace.
//
// Layout (plain DOM injected into #mount, outside Tu's render tree):
//
//   #mount
//     └─ <div class="live-grid">  (3 col: 200px / 1fr / 1fr)
//          ├─ <aside class="live-sidebar">  case picker + file tree
//          ├─ <div   id="live-source">      Monaco editor
//          └─ <div>                          Tu's preview/error pane
//
// Compile pipeline: each file in the active case becomes a separate
// blob URL; cross-file `import "./X.tu"` paths are rewritten to point
// at the matching child blob. The Tu runtime is shared via
// `globalThis.__tuRuntime` so the chain doesn't need a real bundler.

import { compile } from "@tu-lang/compiler"
import { mount } from "@tu-lang/runtime"

import * as LiveEditorMod from "./LiveEditor.tu"
import {
  clearCompileErrors,
  clearCompileErrorsOn,
  createTuEditor,
  createWorkspaceModels,
  setCompileError,
  setCompileErrorOn,
} from "./monaco-tu.tu"
import { CASES } from "./live-cases.tu"

let liveStop = null
let liveDebounceHandle = null
let liveEditor = null
let liveEditorDispose = null
let liveContentSub = null
let liveModels = null
let liveBlobUrls = []
let liveCurrentCaseId = null
let liveCurrentPath = null
let liveSidebarEl = null

let revokeBlobs = external JS (urls: string[]): void {
  for (const u of urls) URL.revokeObjectURL(u)
}

let stopLivePreview = () => {
  if (liveStop) {
    liveStop()
    liveStop = null
  }
  if (liveContentSub) {
    liveContentSub.dispose()
    liveContentSub = null
  }
  if (liveEditorDispose) {
    liveEditorDispose()
    liveEditorDispose = null
  }
  liveEditor = null
  if (liveDebounceHandle != null) {
    clearTimeout(liveDebounceHandle)
    liveDebounceHandle = null
  }
  if (liveModels) {
    liveModels.forEach((m) => m.dispose())
    liveModels = null
  }
  revokeBlobs(liveBlobUrls)
  liveBlobUrls = []
  liveCurrentCaseId = null
  liveCurrentPath = null
  liveSidebarEl = null
  let mountEl = document.getElementById("mount")
  if (mountEl) {
    let grid = mountEl.querySelector(":scope > .live-grid")
    if (grid) { grid.remove() }
  }
}

// Topological sort + per-file compile + blob-URL chain. Each file's
// `./Other.tu` imports are rewritten to point at the matching child
// blob. The runtime import is rewritten to a global destructure so we
// don't need a bundler. Errors carry the offending file path on
// `__tuFile` so the caller can mark the right model.
let buildWorkspace = external JS (compile: any, files: any[], entry: string): any {
  if (globalThis.__tuRuntime == null) {
    throw new Error("__tuRuntime not initialized")
  }
  // Topo sort.
  const byPath = new Map(files.map((f) => [f.path, f]))
  const visited = new Set()
  const sorted = []
  const visit = (path) => {
    if (visited.has(path)) return
    visited.add(path)
    const file = byPath.get(path)
    if (!file) return
    const re = /import\s+(?:[^"']*?from\s+)?["'](\.\/[^"']+\.tu)["']/g
    let m
    while ((m = re.exec(file.content)) !== null) {
      visit(m[1].replace(/^\.\//, ""))
    }
    sorted.push(file)
  }
  for (const f of files) visit(f.path)
  // Compile + chain.
  const urlsByPath = new Map()
  const allUrls = []
  for (const file of sorted) {
    let js
    try {
      js = compile(file.content, { filename: file.path })
    } catch (e) {
      e.__tuFile = file.path
      throw e
    }
    js = js.replace(
      /^import\s+\{([^}]*)\}\s+from\s+["']@tu-lang\/runtime["']\s*;?\s*/m,
      "const {$1} = globalThis.__tuRuntime;\n"
    )
    js = js.replace(/\/\/#\s*sourceMappingURL=[^\n]*\n?/g, "")
    js = js.replace(/from\s+["'](\.\/[^"']+\.tu)["']/g, (_match, p) => {
      const otherPath = p.replace(/^\.\//, "")
      const url = urlsByPath.get(otherPath)
      if (!url) {
        const err = new Error(`Cannot resolve import "${p}" — no such file in case`)
        err.__tuFile = file.path
        throw err
      }
      return `from "${url}"`
    })
    const blob = new Blob([js], { type: "text/javascript" })
    const url = URL.createObjectURL(blob)
    urlsByPath.set(file.path, url)
    allUrls.push(url)
  }
  const entryUrl = urlsByPath.get(entry)
  if (!entryUrl) {
    throw new Error(`entry file "${entry}" not found in case`)
  }
  return { entryUrl, allUrls }
}

let ensureRuntime = external JS (h: any, Signal: any, mount: any): void {
  globalThis.__tuRuntime = globalThis.__tuRuntime ?? { h, Signal, mount }
}

let parseLineCol = external JS (message: string): any {
  const m = /at line (\d+), col (\d+)/.exec(message)
  if (!m) return { line: 1, col: 1 }
  return { line: Number(m[1]), col: Number(m[2]) }
}

let recompileLive = async () => {
  if (!liveCurrentCaseId || !liveModels) { return }
  let caseDef = CASES().find((c) => c.id == liveCurrentCaseId)
  if (!caseDef) { return }
  let files = caseDef.files.map((f) => ({
    path: f.path,
    content: liveModels.get(f.path)?.getValue() ?? f.content,
  }))
  liveModels.forEach((m) => clearCompileErrorsOn(m))
  let App = null
  try {
    revokeBlobs(liveBlobUrls)
    liveBlobUrls = []
    ensureRuntime(h, Signal, mount)
    let built = buildWorkspace(compile, files, caseDef.entry)
    liveBlobUrls = built.allUrls
    let mod = await import(built.entryUrl)
    App = mod.App
    if (App == null) {
      throw new Error("entry must export an `App` lambda — `export let App = () => …`")
    }
    LiveEditorMod.error.set("")
  } catch (e: unknown) {
    let message = e?.message ?? String(e)
    LiveEditorMod.error.set(message)
    let badPath = e?.__tuFile ?? null
    if (badPath != null && liveModels.has(badPath)) {
      let badModel = liveModels.get(badPath)
      let pos = parseLineCol(message)
      setCompileErrorOn(badModel, message, pos.line, pos.col)
    } else if (liveEditor) {
      setCompileError(liveEditor, message)
    }
    if (liveStop) {
      liveStop()
      liveStop = null
    }
    return
  }
  queueMicrotask(() => {
    let host = document.getElementById("live-preview-mount")
    if (!host) { return }
    if (liveStop) { liveStop() }
    liveStop = mount(() => App(), host)
  })
}

let setActiveFile = (path: string) => {
  if (!liveModels || !liveModels.has(path)) { return }
  liveCurrentPath = path
  if (liveEditor) {
    liveEditor.setModel(liveModels.get(path))
  }
  if (liveSidebarEl) {
    let items = liveSidebarEl.querySelectorAll(".live-file")
    items.forEach((el) => {
      if (el.dataset.path == path) {
        el.classList.add("active")
      } else {
        el.classList.remove("active")
      }
    })
  }
}

let renderFileTree = (caseDef: any) => {
  if (!liveSidebarEl) { return }
  let list = liveSidebarEl.querySelector(".live-file-list")
  if (!list) { return }
  list.innerHTML = ""
  caseDef.files.forEach((file) => {
    let item = document.createElement("li")
    item.className = "live-file"
    item.dataset.path = file.path
    item.textContent = file.path
    item.addEventListener("click", () => setActiveFile(file.path))
    list.appendChild(item)
  })
}

let setActiveCase = (caseId: string) => {
  let caseDef = CASES().find((c) => c.id == caseId)
  if (!caseDef) { return }
  if (liveModels) {
    liveModels.forEach((m) => m.dispose())
  }
  liveModels = createWorkspaceModels(caseDef)
  liveCurrentCaseId = caseId
  renderFileTree(caseDef)
  setActiveFile(caseDef.entry)
  recompileLive()
}

let attachLiveCompiler = () => {
  let mountEl = document.getElementById("mount")
  if (!mountEl) { return }
  let tuRight = mountEl.firstElementChild
  if (!tuRight) { return }

  let grid = document.createElement("div")
  grid.className = "live-grid h-full grid grid-cols-[200px_minmax(0,1fr)_minmax(0,1fr)] gap-3 min-h-0"

  let sidebar = document.createElement("aside")
  sidebar.className = "live-sidebar flex flex-col gap-3 min-h-0 overflow-auto p-2 border border-[hsl(var(--tu-border))] rounded-[var(--tu-radius-sm)] bg-[hsl(var(--tu-surface))]"
  liveSidebarEl = sidebar

  let caseLabel = document.createElement("label")
  caseLabel.className = "text-xs font-semibold text-[hsl(var(--tu-fg-muted))] uppercase tracking-wider"
  caseLabel.textContent = "Case"

  let caseSelect = document.createElement("select")
  caseSelect.className = "live-case-picker bg-[hsl(var(--tu-surface-elevated))] text-[hsl(var(--tu-fg))] border border-[hsl(var(--tu-border))] rounded px-2 py-1 text-sm"
  CASES().forEach((c) => {
    let opt = document.createElement("option")
    opt.value = c.id
    opt.textContent = c.label
    caseSelect.appendChild(opt)
  })
  caseSelect.addEventListener("change", () => setActiveCase(caseSelect.value))

  let fileLabel = document.createElement("label")
  fileLabel.className = "text-xs font-semibold text-[hsl(var(--tu-fg-muted))] uppercase tracking-wider mt-2"
  fileLabel.textContent = "Files"

  let fileList = document.createElement("ul")
  fileList.className = "live-file-list flex flex-col gap-1 list-none p-0 m-0"

  sidebar.appendChild(caseLabel)
  sidebar.appendChild(caseSelect)
  sidebar.appendChild(fileLabel)
  sidebar.appendChild(fileList)
  grid.appendChild(sidebar)

  let editorHost = document.createElement("div")
  editorHost.id = "live-source"
  editorHost.className = "min-h-[400px] border border-[hsl(var(--tu-border))] rounded-[var(--tu-radius-sm)] overflow-hidden"
  grid.appendChild(editorHost)

  grid.appendChild(tuRight)
  mountEl.appendChild(grid)

  let pair = createTuEditor(editorHost, "")
  liveEditor = pair.editor
  liveEditorDispose = pair.dispose

  liveContentSub = pair.editor.onDidChangeModelContent(() => {
    if (liveDebounceHandle != null) { clearTimeout(liveDebounceHandle) }
    liveDebounceHandle = setTimeout(() => {
      liveDebounceHandle = null
      recompileLive()
    }, 250)
  })

  let initial = CASES()[0]
  caseSelect.value = initial.id
  setActiveCase(initial.id)
}

export let liveDemo = () => ({
  id: "live",
  setup: () => LiveEditorMod.error.set(""),
  teardown: () => stopLivePreview(),
  thunk: () => LiveEditorMod.LiveEditor(),
  afterMount: () => attachLiveCompiler(),
})

export let liveDemoBlurb = () =>
  "Multi-file Tu workspace — pick a case (counter / composition / todo / async / form), edit any file, watch it recompile + remount on every keystroke. Cross-file `.tu` imports work via blob-URL chains; the Tu runtime is shared globally. Editor has snippet completion (Ctrl-Space), hover, go-to-definition, and find-references — all driven by the in-browser Tu compiler."
