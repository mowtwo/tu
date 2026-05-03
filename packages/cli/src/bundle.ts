// `tu bundle <…files> [-o outDir] [--ts]` — wraps the M8 Phase 6
// `compileBundle()` API. Compiles every `.tu` input together so
// identical interface + anonymous shapes share ONE canonical
// descriptor in a generated `__tu_types.generated.ts` module that
// per-file outputs import from. Headline use case: tu-xing's
// component library, where many `Props` interfaces share fields.

import { compileBundle, type BundleInput, type BundleOptions } from '@tu-lang/compiler'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

export interface BundleCommandOptions {
  /** Working dir to resolve input/output paths against. */
  cwd?: string
  /** Where to emit per-file outputs + the shared module. Defaults to `.tu-out`. */
  outDir?: string
  /** Emit TypeScript when true; JS otherwise. */
  ts?: boolean
}

export interface BundleCommandResult {
  exitCode: number
  /** Number of canonical descriptors emitted (=shapes after merge). */
  descriptorsEmitted: number
  /** Number of source-side shape registrations BEFORE merging. */
  totalShapesSeen: number
  /** Per-file outputs written, in order of emission. */
  filesWritten: string[]
}

/**
 * Run `tu bundle <…files> [-o outDir] [--ts]`. The CLI driver thin-
 * wraps this so test code can invoke without spawning a subprocess.
 *
 * Returns `exitCode` instead of throwing — the CLI prints the
 * surfaced error message itself.
 */
export function runBundle(
  args: ReadonlyArray<string>,
  options: BundleCommandOptions = {}
): BundleCommandResult {
  const cwd = options.cwd ?? process.cwd()
  let outDir = options.outDir ?? '.tu-out'
  const ts = options.ts ?? false
  const inputs: BundleInput[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '-o' || arg === '--out') {
      const next = args[i + 1]
      if (!next) {
        console.error(`tu bundle: ${arg} expects a directory argument`)
        return { exitCode: 1, descriptorsEmitted: 0, totalShapesSeen: 0, filesWritten: [] }
      }
      outDir = next
      i++
      continue
    }
    if (arg === '--ts') continue // already parsed via options
    if (arg.startsWith('-')) {
      console.error(`tu bundle: unknown flag '${arg}'`)
      return { exitCode: 1, descriptorsEmitted: 0, totalShapesSeen: 0, filesWritten: [] }
    }
    const abs = resolve(cwd, arg)
    let source: string
    try {
      source = readFileSync(abs, 'utf-8')
    } catch (err) {
      console.error(
        `tu bundle: cannot read ${arg}: ${err instanceof Error ? err.message : String(err)}`
      )
      return { exitCode: 1, descriptorsEmitted: 0, totalShapesSeen: 0, filesWritten: [] }
    }
    inputs.push({ filename: abs, source })
  }
  if (inputs.length === 0) {
    console.error('tu bundle: at least one input file required')
    return { exitCode: 1, descriptorsEmitted: 0, totalShapesSeen: 0, filesWritten: [] }
  }

  const absOutDir = resolve(cwd, outDir)
  // Module specifier per-file outputs use to import the shared
  // module — relative path keeps the bundle portable.
  const sharedFilename = ts ? '__tu_types.generated.ts' : '__tu_types.generated.js'
  const bundleOptions: BundleOptions = {
    sharedImportPath: `./${sharedFilename.replace(/\.ts$/, '.js')}`,
    sharedOutputPath: sharedFilename,
    emitTS: ts,
  }
  let bundle
  try {
    bundle = compileBundle(inputs, bundleOptions)
  } catch (err) {
    console.error(
      `tu bundle: compile failed: ${err instanceof Error ? err.message : String(err)}`
    )
    return { exitCode: 1, descriptorsEmitted: 0, totalShapesSeen: 0, filesWritten: [] }
  }

  // Emit shared module + per-file outputs.
  mkdirSync(absOutDir, { recursive: true })
  const filesWritten: string[] = []
  const sharedPath = join(absOutDir, sharedFilename)
  writeFileSync(sharedPath, bundle.sharedModule.code)
  filesWritten.push(sharedPath)
  const ext = ts ? '.ts' : '.js'
  for (const [inputPath, result] of bundle.files) {
    const rel = relative(cwd, inputPath).replace(/\.tu$/, ext)
    const out = join(absOutDir, rel)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, result.code)
    filesWritten.push(out)
  }

  // Aggregate counts for the summary print.
  const totalShapesSeen = bundle.canonical.descriptors.reduce(
    (acc, d) => acc + d.origins.length,
    0
  )
  console.log(
    `tu bundle: ${inputs.length} file(s) → ${filesWritten.length} output(s) (${
      bundle.canonical.descriptors.length
    } canonical descriptor(s), ${totalShapesSeen - bundle.canonical.descriptors.length} merge(s))`
  )
  for (const desc of bundle.canonical.descriptors) {
    if (desc.origins.length > 1) {
      console.log(
        `  ✓ ${desc.canonicalName} ← ${desc.origins
          .map((o) => `${relative(cwd, o.filename)}::${o.originalName}`)
          .join(', ')}`
      )
    }
  }
  return {
    exitCode: 0,
    descriptorsEmitted: bundle.canonical.descriptors.length,
    totalShapesSeen,
    filesWritten,
  }
}
