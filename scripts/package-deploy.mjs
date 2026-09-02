import { mkdir, cp, rm, writeFile, readdir, readFile, stat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const exec = promisify(execFile)
const version = (process.env.WANGWANG_VERSION || process.env.npm_package_version || '0.1.0').replace(/^v/, '')
const tag = `v${version}`
const root = fileURLToPath(new URL('..', import.meta.url))
const deployDir = path.join(root, '.deploy')
const stage = path.join(deployDir, `wangwang-${tag}`)
const output = path.join(deployDir, `wangwang-deploy-v${version}.tar.gz`)

await rm(deployDir, { recursive: true, force: true })
await mkdir(path.join(stage, 'assets'), { recursive: true })
await mkdir(path.join(stage, 'migrations'), { recursive: true })
await cp(path.join(root, 'dist/admin/wangwang/index.js'), path.join(stage, 'worker.js'))
await cp(path.join(root, 'dist/admin/client'), path.join(stage, 'assets'), { recursive: true })
await cp(path.join(root, 'drizzle'), path.join(stage, 'migrations'), { recursive: true })

const drizzleEntries = await readdir(path.join(root, 'drizzle'))
const initialMigration =
  drizzleEntries.find((file) => file.startsWith('0000_') && file.endsWith('.sql')) || '0000_initial.sql'
await cp(path.join(root, 'drizzle', initialMigration), path.join(stage, 'migration.sql'))

const assets = {}
async function collect(dir, prefix = '') {
  for (const entry of await readdir(dir)) {
    const file = path.join(dir, entry)
    const relative = `${prefix}/${entry}`
    if ((await stat(file)).isDirectory()) await collect(file, relative)
    else assets[relative] = (await readFile(file)).toString('base64')
  }
}
await collect(path.join(stage, 'assets'))
await writeFile(path.join(stage, 'assets.json'), `${JSON.stringify(assets)}\n`)
await writeFile(
  path.join(stage, 'manifest.json'),
  `${JSON.stringify(
    {
      product: 'wangwang',
      version,
      workerFile: 'worker.js',
      assetsDir: 'assets',
      assetsFile: 'assets.json',
      migrationsDir: 'migrations',
      requiredBindings: {
        d1: ['DB'],
        kv: ['KV'],
        queues: [{ binding: 'JOBS', type: 'producer' }],
      },
      requiredVars: [],
      requiredSecrets: ['SUBSCRIPTION_TOKEN_SECRET'],
    },
    null,
    2,
  )}\n`,
)
await exec('tar', ['-czf', output, '-C', deployDir, `wangwang-${tag}`])
console.log(output)
