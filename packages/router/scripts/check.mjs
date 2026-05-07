import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { compileToTSWithMap } from '@tu-lang/compiler'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const checkDir = join(root, '.tu-check')
const source = await readFile(join(root, 'src', 'index.tu'), 'utf8')
const stripInlineMap = (code) => code.replace(/\n?\/\/# sourceMappingURL=data:application\/json;charset=utf-8;base64,[A-Za-z0-9+/=]+\n?$/, '')

await rm(checkDir, { recursive: true, force: true })
await mkdir(checkDir, { recursive: true })

const ts = compileToTSWithMap(source, { filename: 'src/index.tu' })
await writeFile(join(checkDir, 'index.ts'), stripInlineMap(ts.code))

await new Promise((resolve, reject) => {
  const child = spawn(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['exec', 'tsc', '-p', 'tsconfig.check.json'],
    { cwd: root, stdio: 'inherit' }
  )
  child.on('error', reject)
  child.on('exit', (code) => {
    if (code === 0) resolve()
    else reject(new Error(`tsc exited with code ${code}`))
  })
})
