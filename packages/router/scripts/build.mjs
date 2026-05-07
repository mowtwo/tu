import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { compileToTSWithMap, compileWithMap } from '@tu-lang/compiler'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = join(root, 'src', 'index.tu')
const distDir = join(root, 'dist')
const buildDir = join(root, '.tu-build')
const source = await readFile(sourcePath, 'utf8')
const filename = 'src/index.tu'

await rm(distDir, { recursive: true, force: true })
await rm(buildDir, { recursive: true, force: true })
await mkdir(distDir, { recursive: true })
await mkdir(buildDir, { recursive: true })

const stripInlineMap = (code) => code.replace(/\n?\/\/# sourceMappingURL=data:application\/json;charset=utf-8;base64,[A-Za-z0-9+/=]+\n?$/, '')

const js = compileWithMap(source, { filename })
await writeFile(join(distDir, 'index.js'), `${stripInlineMap(js.code)}\n//# sourceMappingURL=index.js.map\n`)
await writeFile(join(distDir, 'index.js.map'), JSON.stringify({
  ...js.map,
  file: 'index.js',
  sources: ['../src/index.tu'],
}))

const ts = compileToTSWithMap(source, { filename })
await writeFile(join(buildDir, 'index.ts'), stripInlineMap(ts.code))

await new Promise((resolve, reject) => {
  const child = spawn(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['exec', 'tsc', '-p', 'tsconfig.dts.json'],
    { cwd: root, stdio: 'inherit' }
  )
  child.on('error', reject)
  child.on('exit', (code) => {
    if (code === 0) resolve()
    else reject(new Error(`tsc exited with code ${code}`))
  })
})
