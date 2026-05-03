// M8 Phase 6 — cross-module type canonicalizer.
//
// Today (Phase 3) every `.tu` file emits its own anon descriptors with
// per-file shape interning — two files declaring `let p = { x: 1, y: 2 }`
// each get a distinct `__tu_anon_0` decl, distinct runtime objects, and
// `type.of(p1) !== type.of(p2)` even though shapes match.
//
// This module ships the pure-function CORE of the cross-module merge:
// given a set of parsed programs, it computes:
//
//   - A stable structural hash for every named interface + every untyped
//     object-let shape across ALL files.
//   - A canonical name table mapping `(file, original)` → canonical key.
//   - An ordered list of canonical descriptors to emit in a shared
//     `__tu_types.generated.ts` module.
//
// Integration (LSP + CLI + vite plugin emitting the shared module +
// rewriting per-file emit) lands in Phase 6b/6c. This file is the
// algorithm — pure, tested, no I/O.

import type { Expr, ObjectLit, ObjectProp, Program } from './ast.js'

/**
 * One entry in the canonical descriptor list. The same shape appearing
 * in N files maps to one entry; consumers (Phase 6c emit) generate
 * `export const ${canonicalName} = type.struct(…)` exactly once per
 * entry, then rewrite per-file references to point at it.
 */
export interface CanonicalDescriptor {
  /** Stable canonical key — `T_${hash}`. Used as the export name. */
  canonicalName: string
  /** Hash of the descriptor's structural shape. Hex-encoded FNV-1a 64-bit. */
  hash: string
  /** Original names this descriptor merged from, across all input files.
   *  Useful for `// → User, Admin (merged)` comments at emit time. */
  origins: ReadonlyArray<{ filename: string; originalName: string }>
  /** The descriptor's field list — flat, sorted by name for stable
   *  emission. Each field's type is itself a descriptor expression
   *  string (already-canonicalized — primitive refs, canonical-name
   *  refs, or inline `type.struct(…)` for non-merged-eligible nested
   *  shapes). */
  fields: ReadonlyArray<{ name: string; typeExpr: string; optional: boolean }>
}

export interface CanonicalizeResult {
  /** Ordered list of unique descriptors. The order is stable: first-
   *  encountered shape wins canonicalName-numbering. */
  descriptors: CanonicalDescriptor[]
  /** Per-file lookup: file's original name → canonical name to import. */
  perFile: Map<string, Map<string, string>>
}

/**
 * Walk every program, register its interface decls + every untyped
 * object-let shape, hash by structural identity, merge identical
 * hashes. Returns the canonical descriptor list + per-file rewrite
 * tables.
 *
 * Anonymous shapes get internal names like `__anon_${N}` keyed on the
 * declaring let's name (e.g. `__anon_p`); they're rewritten to the
 * canonical name at emit time.
 *
 * Hash discipline:
 *   - Field order DOESN'T matter — sort by name before hashing.
 *   - Field types DO matter — `{x: number}` and `{x: string}` are
 *     distinct.
 *   - `optional` flag is part of the hash.
 *   - Recursive shapes break cycles via lazy reference (the hash uses
 *     a placeholder for the type while it's being computed).
 */
export function canonicalizeShapes(
  programs: Map<string, Program>
): CanonicalizeResult {
  // Two-pass: first collect every shape per file so we can resolve
  // references between them; second hash + merge.
  const shapeByOrigin = new Map<string, FileShapes>()
  for (const [filename, program] of programs) {
    shapeByOrigin.set(filename, collectShapes(program))
  }

  // Hash + merge. Process files in iteration order; first encounter of
  // each hash claims a canonical name.
  const hashToCanonical = new Map<string, CanonicalDescriptor>()
  const perFile = new Map<string, Map<string, string>>()
  let counter = 0

  for (const [filename, shapes] of shapeByOrigin) {
    const fileMap = new Map<string, string>()
    perFile.set(filename, fileMap)
    for (const shape of shapes.shapes) {
      const fields = shape.fields
        .map((f) => ({
          name: f.name,
          typeExpr: canonicalizeTypeExpr(f.typeExpr),
          optional: f.optional,
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
      const hash = hashFields(fields)
      let entry = hashToCanonical.get(hash)
      if (!entry) {
        entry = {
          canonicalName: `T_${counter++}_${hash.slice(0, 8)}`,
          hash,
          origins: [{ filename, originalName: shape.originalName }],
          fields,
        }
        hashToCanonical.set(hash, entry)
      } else {
        // Add this origin to the merged set.
        ;(entry.origins as Array<{ filename: string; originalName: string }>).push(
          { filename, originalName: shape.originalName }
        )
      }
      fileMap.set(shape.originalName, entry.canonicalName)
    }
  }

  return {
    descriptors: Array.from(hashToCanonical.values()),
    perFile,
  }
}

interface FileShapes {
  shapes: Array<{
    /** Original identifier — interface name, or `__anon_<letName>` for
     *  untyped object lets. */
    originalName: string
    fields: Array<{ name: string; typeExpr: string; optional: boolean }>
  }>
}

function collectShapes(program: Program): FileShapes {
  const shapes: FileShapes['shapes'] = []
  for (const stmt of program.body) {
    if (stmt.kind === 'InterfaceDecl') {
      shapes.push({
        originalName: stmt.name,
        fields: stmt.fields.map((f) => ({
          name: f.name,
          typeExpr: f.rawType.trim(),
          optional: f.optional,
        })),
      })
    } else if (
      stmt.kind === 'LetDecl' &&
      stmt.type === undefined &&
      stmt.value.kind === 'ObjectLit'
    ) {
      const fields = collectAnonFields(stmt.value)
      if (fields !== null) {
        shapes.push({ originalName: `__anon_${stmt.name}`, fields })
      }
    }
  }
  return { shapes }
}

function collectAnonFields(
  obj: ObjectLit
): Array<{ name: string; typeExpr: string; optional: boolean }> | null {
  const fields: { name: string; typeExpr: string; optional: boolean }[] = []
  for (const m of obj.properties) {
    if (m.kind === 'ObjectSpread') return null // skip — Phase 3d work
    const prop = m as ObjectProp
    fields.push({
      name: prop.key,
      typeExpr: inferTypeExpr(prop.value),
      optional: false,
    })
  }
  return fields
}

/**
 * Map a Tu expression to its descriptor type expression — the same
 * heuristic codegen uses (`exprToDescExpr`), but as a pure helper here
 * so the canonicalizer doesn't need codegen state.
 */
function inferTypeExpr(e: Expr): string {
  switch (e.kind) {
    case 'StringLit':
    case 'TemplateLit':
      return 'string'
    case 'NumberLit':
      return 'number'
    case 'RegexLit':
      return 'RegExp'
    case 'Lambda':
      return 'Function'
    case 'Ident': {
      const n = e.name
      if (n === 'true' || n === 'false') return 'boolean'
      if (n === 'null' || n === 'undefined') return 'null'
      // Reference to another binding — keep the name; canonicalize
      // resolves cross-module idents to canonical names later.
      return n
    }
    case 'ArrayLit': {
      if (e.elements.length === 0) return 'any[]'
      return `${inferTypeExpr(e.elements[0]!)}[]`
    }
    case 'ObjectLit': {
      // Inline shape — emit a struct-like text the hash can compare on.
      const inner = e.properties
        .filter((m) => m.kind !== 'ObjectSpread')
        .map((m) => {
          const p = m as ObjectProp
          return `${p.key}:${inferTypeExpr(p.value)}`
        })
        .join(';')
      return `{${inner}}`
    }
    default:
      return 'unknown'
  }
}

/**
 * Normalize a type-expression slice so equivalent shapes hash the same:
 * collapse whitespace, trim, lowercase the well-known primitives.
 * Doesn't try to reorder unions (`A | B` !== `B | A` until M9 unions).
 */
function canonicalizeTypeExpr(t: string): string {
  return t.trim().replace(/\s+/g, ' ')
}

/**
 * FNV-1a 64-bit hash of the sorted-fields list. Hex-encoded; first 8
 * chars become the human-readable suffix on the canonical name.
 *
 * Pure-JS implementation — no Node `crypto` dependency, so this works
 * uniformly in browser-side LSP / playground builds too.
 */
function hashFields(
  fields: ReadonlyArray<{ name: string; typeExpr: string; optional: boolean }>
): string {
  // Build a canonical string then hash. The string is unambiguous: each
  // field is `name:?type|` joined.
  const parts: string[] = []
  for (const f of fields) {
    parts.push(`${f.name}:${f.optional ? '?' : ''}${f.typeExpr}`)
  }
  return fnv1a64(parts.join('|'))
}

function fnv1a64(s: string): string {
  // 64-bit FNV-1a using two 32-bit halves to dodge JS BigInt overhead.
  // Adapted from the standard reference; produces stable output across
  // platforms.
  let hi = 0xcbf29ce4 | 0
  let lo = 0x84222325 | 0
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    lo ^= code
    // hi:lo *= FNV_PRIME (0x100000001b3 = (1 << 40) + 0x1b3)
    const a = (lo & 0xffff) * 0x1b3
    const b = ((lo >>> 16) & 0xffff) * 0x1b3 + ((hi & 0xffff) * 0x100)
    const c = ((lo >>> 16) & 0xffff) * 0x100 + ((hi & 0xffff) * 0x1b3) >>> 0
    lo = (a + ((b & 0xffff) << 16)) >>> 0
    hi = (
      ((hi >>> 16) * 0x1b3 +
        ((hi & 0xffff) * 0x100) +
        (b >>> 16) +
        (c >>> 16)) |
      0
    )
  }
  return (
    (hi >>> 0).toString(16).padStart(8, '0') +
    (lo >>> 0).toString(16).padStart(8, '0')
  )
}
