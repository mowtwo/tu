import { classifyTopLevel, parse, tokenize, type CellKind } from '@tu-lang/compiler'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/**
 * For one `.tu` file's source + path, walk its top-level `ImportDecl`s,
 * sync-read each relative `./*.tu` neighbor, and classify the names being
 * imported (state / computed / function). Returns the merged map suitable
 * for `compileWithMap`'s `importedNameKinds` option.
 *
 * This is the bare minimum — direct exports only. Multi-hop re-exports
 * fall through to the compiler's `'function'` default. Errors during
 * sibling reads / parses are swallowed silently; the original importer
 * still compiles (with the bug-pre-M2.3 behavior for un-classified names).
 *
 * Synchronous on purpose: vite's `load` hook is async-friendly but the I/O
 * is small (one file per import) and the simplicity is worth it. If this
 * shows up in profiles we can move to a per-build memoizing cache.
 */
export function importedNameKindsFor(
  source: string,
  filename: string
): Map<string, CellKind> | undefined {
  let ast
  try {
    ast = parse(tokenize(source, filename), source, filename)
  } catch {
    return undefined
  }
  let result: Map<string, CellKind> | undefined
  for (const stmt of ast.body) {
    if (stmt.kind !== 'ImportDecl') continue
    if (!stmt.source.endsWith('.tu') || !stmt.source.startsWith('.')) continue
    const importPath = resolve(dirname(filename), stmt.source)
    const targetExports = readDirectExportKinds(importPath)
    if (!targetExports) continue
    for (const name of stmt.names) {
      const kind = targetExports.get(name)
      if (kind === undefined) continue
      if (!result) result = new Map()
      result.set(name, kind)
    }
  }
  return result
}

function readDirectExportKinds(path: string): Map<string, CellKind> | undefined {
  let src: string
  try {
    src = readFileSync(path, 'utf-8')
  } catch {
    return undefined
  }
  let ast
  try {
    ast = parse(tokenize(src, path), src, path)
  } catch {
    return undefined
  }
  const out = new Map<string, CellKind>()
  for (const stmt of ast.body) {
    if (stmt.kind === 'LetDecl' && stmt.exported) {
      out.set(stmt.name, classifyTopLevel(stmt.value))
    }
  }
  return out
}
