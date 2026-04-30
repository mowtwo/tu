// M2 demo: compile Clicker.tu to BOTH .mjs (runtime) and .ts (typecheck +
// .d.ts emit). Run `tsc --noEmit` over the .ts to prove tsserver accepts the
// shape, then `tsc --emitDeclarationOnly` to produce dist/Clicker.d.ts.
import { compileToTS } from '@tu/compiler'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..', '..')
const sourcePath = resolve(__dirname, 'Clicker.tu')
// Compiled TS lives alongside .tu (not under dist/) so tsc's default
// exclude-of-outDir doesn't drop it before checking.
const tsPath = resolve(__dirname, 'Clicker.ts')
const distDir = resolve(__dirname, 'dist')
const tsconfigPath = resolve(__dirname, 'tsconfig.typecheck.json')

mkdirSync(distDir, { recursive: true })

const tu = readFileSync(sourcePath, 'utf-8')
const ts = compileToTS(tu, { filename: 'Clicker.tu' })
writeFileSync(tsPath, ts)

console.log('--- compiled TS (with preserved param types) ---')
console.log(ts.split('//# sourceMappingURL=')[0].trim())

// Minimal tsconfig pointing at @tu/runtime's bundled .d.ts so tsc resolves
// the import without needing node_modules to be hoisted into dist/.
const runtimeTypes = resolve(repoRoot, 'packages', 'runtime', 'dist', 'index.d.ts')
writeFileSync(
  tsconfigPath,
  JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        strict: true,
        skipLibCheck: true,
        declaration: true,
        emitDeclarationOnly: true,
        outDir: 'dist',
        paths: {
          '@tu/runtime': [runtimeTypes],
        },
      },
      include: ['Clicker.ts'],
    },
    null,
    2
  )
)

const tscBin = resolve(repoRoot, 'node_modules', '.bin', 'tsc')

console.log('\n--- tsc --noEmit ---')
try {
  execFileSync(tscBin, ['--project', tsconfigPath, '--noEmit'], {
    cwd: __dirname,
    stdio: 'pipe',
  })
  console.log('  (no type errors)')
} catch (err) {
  console.error(err.stdout?.toString() ?? err.message)
  process.exit(1)
}

console.log('\n--- tsc --emitDeclarationOnly ---')
execFileSync(tscBin, ['--project', tsconfigPath], {
  cwd: __dirname,
  stdio: 'pipe',
})

const dts = readFileSync(resolve(distDir, 'Clicker.d.ts'), 'utf-8')
console.log(dts)

console.log('--- summary ---')
const dtsExports = (dts.match(/^export declare /gm) ?? []).length
console.log(`  ${tsPath} (compiled TS, ${ts.split('\n').length} lines)`)
console.log(`  ${distDir}/Clicker.d.ts (${dtsExports} export(s))`)
console.log('  Private helpers (dec/inc/reset) do NOT appear in the .d.ts.')
