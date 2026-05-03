// Live editor — multi-file Tu workspace, VS Code-style chrome, all in
// plain DOM (Tu's render tree only mounts user-authored App).
//
// Layout injected into #mount:
//
//   #mount
//     └─ <div class="live-grid">
//          ├─ <aside class="live-sidebar">          case + file lists
//          ├─ <div class="live-pane editor">         file path / Monaco
//          └─ <div class="live-pane preview">        tabs / preview / error / JS / DTS

import { compile, compileToTS } from "@tu-lang/compiler"
import { mount } from "@tu-lang/dom"
import { type } from "@tu-lang/std"

import {
  clearCompileErrorsOn,
  createTuEditor,
  createWorkspaceModels,
  setCompileErrorOn,
} from "./monaco-tu.tu"
import { CASES, CaseDefinition, CaseFile } from "./live-cases.tu"

let liveStop = null
let liveDebounceHandle = null
let liveEditor = null
let liveEditorDispose = null
let liveContentSub = null
let liveModels = null
let liveBlobUrls = []
let liveCurrentCaseId = null
let liveCurrentPath = null
let liveCurrentTab = "preview"  // "preview" | "error" | "js" | "dts"
let liveErrorMessage = ""
// DOM refs (cached during attachLiveCompiler).
let liveSidebarEl = null
let livePathBarEl = null
let liveStatusEl = null
let liveTabsEl = null
let livePreviewMountEl = null
let liveErrorEl = null
let liveJsViewEl = null
let liveDtsViewEl = null
let liveJsEditor = null
let liveJsEditorDispose = null
let liveDtsEditor = null
let liveDtsEditorDispose = null

let revokeBlobs = external JS (urls: string[]): void {
  for (const u of urls) URL.revokeObjectURL(u)
}

let stopLivePreview = () => {
  document.body.classList.remove("mode-live")
  if (liveStop) { liveStop(); liveStop = null }
  if (liveContentSub) { liveContentSub.dispose(); liveContentSub = null }
  if (liveEditorDispose) { liveEditorDispose(); liveEditorDispose = null }
  if (liveJsEditorDispose) { liveJsEditorDispose(); liveJsEditorDispose = null }
  if (liveDtsEditorDispose) { liveDtsEditorDispose(); liveDtsEditorDispose = null }
  liveEditor = null
  liveJsEditor = null
  liveDtsEditor = null
  if (liveDebounceHandle != null) { clearTimeout(liveDebounceHandle); liveDebounceHandle = null }
  if (liveModels) { liveModels.forEach((m) => m.dispose()); liveModels = null }
  revokeBlobs(liveBlobUrls)
  liveBlobUrls = []
  liveCurrentCaseId = null
  liveCurrentPath = null
  liveCurrentTab = "preview"
  liveErrorMessage = ""
  liveSidebarEl = null
  livePathBarEl = null
  liveStatusEl = null
  liveTabsEl = null
  livePreviewMountEl = null
  liveErrorEl = null
  liveJsViewEl = null
  liveDtsViewEl = null
  let mountEl = document.getElementById("mount")
  if (mountEl) {
    let grid = mountEl.querySelector(":scope > .live-grid")
    if (grid) { grid.remove() }
  }
}

// Topo-sort + per-file compile + blob-URL chain. See live-demo.tu's
// previous incarnation for the full design notes.
let buildWorkspace = external JS (compile: any, files: any[], entry: string): any {
  if (globalThis.__tuRuntime == null) {
    throw new Error("__tuRuntime not initialized")
  }
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
    while ((m = re.exec(file.content)) !== null) visit(m[1].replace(/^\.\//, ""))
    sorted.push(file)
  }
  for (const f of files) visit(f.path)
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
    // Rewrite the M1 runtime import to read from the global runtime
    // bag — the blob URL the compiled JS lives in can't resolve
    // bare specifiers itself.
    js = js.replace(
      /^import\s+\{([^}]*)\}\s+from\s+["']@tu-lang\/runtime["']\s*;?\s*/m,
      "const {$1} = globalThis.__tuRuntime;\n"
    )
    // M8/M9 — `import { type } from '@tu-lang/std'` is auto-injected
    // whenever a Tu source declares `interface` / `Exception` / a
    // typed-let with an interface annotation. Rewrite the same way:
    // pull from `__tuRuntime` (which carries `type` alongside h/Signal/mount).
    js = js.replace(
      /^import\s+\{([^}]*)\}\s+from\s+["']@tu-lang\/std["']\s*;?\s*/m,
      "const {$1} = globalThis.__tuRuntime;\n"
    )
    js = js.replace(/\/\/#\s*sourceMappingURL=[^\n]*\n?/g, "")
    js = js.replace(/from\s+["'](\.\/[^"']+\.tu)["']/g, (_match, p) => {
      const otherPath = p.replace(/^\.\//, "")
      const url = urlsByPath.get(otherPath)
      if (!url) {
        const err = new Error(`Cannot resolve "${p}" — no such file in case`)
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
  if (!entryUrl) { throw new Error(`entry "${entry}" not in case`) }
  return { entryUrl, allUrls }
}

let ensureRuntime = external JS (h: unknown, Signal: unknown, mount: unknown, type: unknown): void {
  // Globals consumed by the rewriter in `buildWorkspace`. M8/M9 added
  // `type` (`@tu-lang/std`'s namespace) — cells in the live demo that
  // declare `interface` or `Exception` rely on it being present.
  globalThis.__tuRuntime = globalThis.__tuRuntime ?? { h, Signal, mount, type }
}

let parseLineCol = external JS (message: string): any {
  const m = /at line (\d+), col (\d+)/.exec(message)
  if (!m) return { line: 1, col: 1 }
  return { line: Number(m[1]), col: Number(m[2]) }
}

// Pull a `.d.ts`-style declaration view out of the TS-shadow output:
// strip imports, drop `const X = …` initializers, keep only the
// shape of `export const X` / `export interface XProps` / `export
// type X = …` lines. Source-map footer + private (non-export) decls
// drop. This is a heuristic — full DTS emission would need tsc, which
// is too heavy for the browser bundle.
let extractDts = external JS (tsSource: string): string {
  const lines = []
  // Strip the source-map footer.
  const src = tsSource.replace(/\/\/#\s*sourceMappingURL=[^\n]*\n?/g, "").trim()
  const stmts = src.split(/\n(?=(?:export\s+|import\s+|interface\s+|type\s+|const\s+|let\s+|class\s+|enum\s+|function\s+|async\s+))/)
  for (const stmt of stmts) {
    const trimmed = stmt.trim()
    if (!trimmed) continue
    // Skip the runtime import — irrelevant to consumers of the .d.ts.
    if (/^import\s+.*?@tu-lang\/runtime/.test(trimmed)) continue
    // Type aliases / interfaces — pass through as-is.
    if (/^export\s+(type|interface)\s+/.test(trimmed)) {
      lines.push(trimmed)
      continue
    }
    // Exported const / let — emit a `declare`-style stub. We try to
    // grab the type annotation (`: T`) if Tu wrote one; otherwise
    // we use the RHS shape to guess (`= () => …` ⇒ function, etc.)
    const m = /^export\s+(const|let)\s+([A-Za-z_$][\w$]*)\s*(?::\s*([^=]+?))?\s*=\s*([\s\S]+)$/.exec(trimmed)
    if (m) {
      const name = m[2]
      const annotated = m[3]?.trim()
      const rhs = m[4].trim().replace(/[;]\s*$/, "")
      let ty = annotated
      if (!ty) {
        if (/^async\s*\(/.test(rhs) || /^\([^)]*\)\s*=>/.test(rhs) || /^[A-Za-z_$][\w$]*\s*=>/.test(rhs)) {
          ty = "(...args: any[]) => any"
        } else if (/^new\s+Signal\.State/.test(rhs)) {
          ty = "Signal.State<unknown>"
        } else if (/^new\s+Signal\.Computed/.test(rhs)) {
          ty = "Signal.Computed<unknown>"
        } else {
          ty = "unknown"
        }
      }
      lines.push(`export declare const ${name}: ${ty}`)
      continue
    }
    // Anything else (private const, etc.) — drop.
  }
  return lines.length > 0 ? lines.join("\n") : "// (no exports)"
}

// Update JS / DTS read-only views with the active file's compile output.
let refreshOutputViews = () => {
  if (!liveEditor || !liveModels) { return }
  let path = liveCurrentPath
  if (path == null) { return }
  let model = liveModels.get(path)
  if (!model) { return }
  let src = model.getValue()
  let jsOut = ""
  let dtsOut = ""
  try { jsOut = compile(src, { filename: path }) } catch (e: unknown) { jsOut = "// " + (e?.message ?? String(e)) }
  // Strip Tu's source-map footer from the JS too — the read-only
  // editor doesn't benefit from it and it dwarfs the actual code.
  jsOut = jsOut.replace(/\/\/#\s*sourceMappingURL=[^\n]*\n?/g, "").trim()
  try {
    let tsOut = compileToTS(src, { filename: path })
    dtsOut = extractDts(tsOut)
  } catch (e: unknown) {
    dtsOut = "// " + (e?.message ?? String(e))
  }
  if (liveJsEditor) { liveJsEditor.getModel()?.setValue(jsOut) }
  if (liveDtsEditor) { liveDtsEditor.getModel()?.setValue(dtsOut) }
}

let setStatus = (kind: string, text: string) => {
  if (!liveStatusEl) { return }
  liveStatusEl.className = "status " + kind
  liveStatusEl.textContent = text
}

let recompileLive = async (): Promise<void> => {
  if (!liveCurrentCaseId || !liveModels) { return }
  let caseDef = CASES().find((c) => c.id == liveCurrentCaseId)
  if (!caseDef) { return }
  let files = caseDef.files.map((f) => ({
    path: f.path,
    content: liveModels.get(f.path)?.getValue() ?? f.content,
  }))
  liveModels.forEach((m) => clearCompileErrorsOn(m))
  refreshOutputViews()
  let App = null
  try {
    revokeBlobs(liveBlobUrls)
    liveBlobUrls = []
    ensureRuntime(h, Signal, mount, type)
    let built = buildWorkspace(compile, files, caseDef.entry)
    liveBlobUrls = built.allUrls
    let mod = await import(built.entryUrl)
    App = mod.App
    if (App == null) { throw new Error("entry must export an `App` lambda") }
    liveErrorMessage = ""
    setStatus("ok", "✓ live")
    if (liveErrorEl) { liveErrorEl.style.display = "none" }
    if (liveCurrentTab == "error") { setActiveTab("preview") }
  } catch (e: unknown) {
    let message = e?.message ?? String(e)
    liveErrorMessage = message
    setStatus("err", "✗ error")
    if (liveErrorEl) {
      liveErrorEl.textContent = message
      liveErrorEl.style.display = "block"
    }
    let badPath = e?.__tuFile ?? null
    if (badPath != null && liveModels.has(badPath)) {
      let pos = parseLineCol(message)
      setCompileErrorOn(liveModels.get(badPath), message, pos.line, pos.col)
    }
    if (liveStop) { liveStop(); liveStop = null }
    setActiveTab("error")
    return
  }
  queueMicrotask(() => {
    if (!livePreviewMountEl) { return }
    if (liveStop) { liveStop() }
    liveStop = mount(() => App(), livePreviewMountEl)
  })
}

let updatePathBar = () => {
  if (!livePathBarEl || liveCurrentPath == null) { return }
  let caseDef = CASES().find((c) => c.id == liveCurrentCaseId)
  let prefix = if (caseDef) { caseDef.label + " / " } else { "" }
  livePathBarEl.textContent = prefix + liveCurrentPath
}

let setActiveTab = (tab: string) => {
  liveCurrentTab = tab
  if (liveTabsEl) {
    let buttons = liveTabsEl.querySelectorAll(".live-tab")
    buttons.forEach((b) => {
      if (b.dataset.tab == tab) { b.classList.add("active") } else { b.classList.remove("active") }
    })
  }
  let views = [
    { tab: "preview", el: livePreviewMountEl },
    { tab: "error", el: liveErrorEl },
    { tab: "js", el: liveJsViewEl },
    { tab: "dts", el: liveDtsViewEl },
  ]
  views.forEach((v) => {
    if (v.el == null) { return }
    if (v.tab == tab) {
      v.el.style.display = "block"
    } else {
      v.el.style.display = "none"
    }
  })
  if (tab == "js" || tab == "dts") {
    refreshOutputViews()
    queueMicrotask(() => {
      if (tab == "js" && liveJsEditor) { liveJsEditor.layout() }
      if (tab == "dts" && liveDtsEditor) { liveDtsEditor.layout() }
    })
  }
}

let setActiveFile = (path: string) => {
  if (!liveModels || !liveModels.has(path)) { return }
  liveCurrentPath = path
  if (liveEditor) { liveEditor.setModel(liveModels.get(path)) }
  if (liveSidebarEl) {
    let items = liveSidebarEl.querySelectorAll(".live-file-tab")
    items.forEach((el) => {
      if (el.dataset.path == path) { el.classList.add("active") } else { el.classList.remove("active") }
    })
  }
  refreshOutputViews()
}

let renderFileTabs = (caseDef: CaseDefinition): void => {
  if (!liveSidebarEl) { return }
  let tabs = liveSidebarEl.querySelector(".live-file-tabs")
  if (!tabs) { return }
  tabs.innerHTML = ""
  caseDef.files.forEach((file: CaseFile) => {
    let item = document.createElement("div")
    item.className = "live-file-tab"
    item.dataset.path = file.path
    item.textContent = file.path
    item.addEventListener("click", () => setActiveFile(file.path))
    tabs.appendChild(item)
  })
}

let setActiveCase = (caseId: string) => {
  let caseDef = CASES().find((c) => c.id == caseId)
  if (!caseDef) { return }
  if (liveModels) { liveModels.forEach((m) => m.dispose()) }
  liveModels = createWorkspaceModels(caseDef)
  liveCurrentCaseId = caseId
  renderFileTabs(caseDef)
  setActiveFile(caseDef.entry)
  recompileLive()
}

let createReadOnlyMonaco = external JS (host: any, language: string): any {
  const m = globalThis.__tuMonaco
  if (!m) throw new Error("monaco not loaded")
  const editor = m.editor.create(host, {
    value: "",
    language,
    theme: "tu-dark",
    readOnly: true,
    automaticLayout: true,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 12,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    lineNumbers: "on",
    renderWhitespace: "none",
    wordWrap: "on",
    padding: { top: 8, bottom: 8 },
  })
  return { editor, dispose: () => { editor.getModel()?.dispose(); editor.dispose() } }
}

let attachLiveCompiler = (): void => {
  let mountEl = document.getElementById("mount")
  if (!mountEl) { return }
  // Live demo takes over the whole viewport — playground chrome
  // (sidebar / stage header) is hidden via body.mode-live.
  document.body.classList.add("mode-live")
  mountEl.innerHTML = ""

  let grid = document.createElement("div")
  grid.className = "live-grid"

  // ── Toolbar (40px tall) ──
  let toolbar = document.createElement("div")
  toolbar.className = "live-toolbar"
  liveSidebarEl = toolbar  // re-used as the host of file-tabs queries

  // Back button — exits live mode and returns to the playground demo
  // grid. We just navigate to the default hash (#hello) so the main
  // hash router takes over; stopLivePreview tears down everything via
  // the demo lifecycle's teardown.
  let backBtn = document.createElement("button")
  backBtn.className = "live-back"
  backBtn.title = "Back to playground"
  backBtn.innerHTML = "← Back"
  backBtn.addEventListener("click", () => {
    window.location.hash = "#hello"
  })

  let brand = document.createElement("div")
  brand.className = "live-brand"
  brand.innerHTML = `Tu <span class="live-brand-cn">图</span> <span class="live-brand-tag">Live</span>`

  let caseSelect = document.createElement("select")
  caseSelect.className = "live-case-picker"
  CASES().forEach((c) => {
    let opt = document.createElement("option")
    opt.value = c.id
    opt.textContent = c.label
    caseSelect.appendChild(opt)
  })
  caseSelect.addEventListener("change", () => setActiveCase(caseSelect.value))

  let fileTabs = document.createElement("div")
  fileTabs.className = "live-file-tabs"

  let spacer = document.createElement("div")
  spacer.className = "live-toolbar-spacer"

  let viewTabs = document.createElement("div")
  viewTabs.className = "live-view-tabs live-tabs"
  ;[
    { tab: "preview", label: "Preview" },
    { tab: "js", label: "JS" },
    { tab: "dts", label: ".d.ts" },
  ].forEach((t) => {
    let btn = document.createElement("button")
    btn.className = "live-tab"
    btn.dataset.tab = t.tab
    btn.textContent = t.label
    btn.addEventListener("click", () => setActiveTab(t.tab))
    viewTabs.appendChild(btn)
  })
  liveTabsEl = viewTabs

  let status = document.createElement("span")
  status.className = "live-status"
  status.textContent = ""
  liveStatusEl = status

  toolbar.appendChild(backBtn)
  toolbar.appendChild(brand)
  toolbar.appendChild(caseSelect)
  toolbar.appendChild(fileTabs)
  toolbar.appendChild(spacer)
  toolbar.appendChild(viewTabs)
  toolbar.appendChild(status)
  grid.appendChild(toolbar)

  // ── Split (editor / preview) ──
  let split = document.createElement("div")
  split.className = "live-split"

  let editorPane = document.createElement("div")
  editorPane.className = "live-pane editor"
  let editorBody = document.createElement("div")
  editorBody.className = "live-pane-body editor"
  editorBody.id = "live-source"
  editorPane.appendChild(editorBody)
  split.appendChild(editorPane)

  let previewPane = document.createElement("div")
  previewPane.className = "live-pane preview"

  let previewBody = document.createElement("div")
  previewBody.className = "live-pane-body preview"
  previewBody.style.padding = "0"
  previewBody.style.position = "relative"

  let previewMount = document.createElement("div")
  previewMount.id = "live-preview-mount"
  previewMount.style.padding = "1.5rem"
  previewMount.style.minHeight = "100%"
  livePreviewMountEl = previewMount

  let errorView = document.createElement("pre")
  errorView.className = "live-pane-body error"
  errorView.style.display = "none"
  errorView.style.margin = "0"
  errorView.style.minHeight = "100%"
  liveErrorEl = errorView

  let jsView = document.createElement("div")
  jsView.style.display = "none"
  jsView.style.height = "100%"
  liveJsViewEl = jsView

  let dtsView = document.createElement("div")
  dtsView.style.display = "none"
  dtsView.style.height = "100%"
  liveDtsViewEl = dtsView

  previewBody.appendChild(previewMount)
  previewBody.appendChild(errorView)
  previewBody.appendChild(jsView)
  previewBody.appendChild(dtsView)
  previewPane.appendChild(previewBody)
  split.appendChild(previewPane)

  grid.appendChild(split)
  mountEl.appendChild(grid)

  let pair = createTuEditor(editorBody, "")
  liveEditor = pair.editor
  liveEditorDispose = pair.dispose

  let jsPair = createReadOnlyMonaco(jsView, "javascript")
  liveJsEditor = jsPair.editor
  liveJsEditorDispose = jsPair.dispose

  let dtsPair = createReadOnlyMonaco(dtsView, "typescript")
  liveDtsEditor = dtsPair.editor
  liveDtsEditorDispose = dtsPair.dispose

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
  setActiveTab("preview")
}

export let liveDemo = () => ({
  id: "live",
  setup: () => undefined,
  teardown: () => stopLivePreview(),
  thunk: () => h("div", { class: "live-anchor" }, []),
  afterMount: () => attachLiveCompiler(),
})

export let liveDemoBlurb = () =>
  "Multi-file Tu workspace — pick a case in the sidebar, edit any file, see Preview / JS / .d.ts on the right. Cross-file `.tu` imports work via blob-URL chains. Editor has snippet completion (Ctrl-Space), hover, go-to-definition, and find-references."
