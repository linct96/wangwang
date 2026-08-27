import { mkdir, cp, rm, writeFile, readdir, readFile, stat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const version = (process.env.WANGWANG_VERSION || process.env.npm_package_version || '0.1.0').replace(/^v/, '')
const tag = `v${version}`
const root = new URL('..', import.meta.url).pathname
const stage = `${root}/.deploy/wangwang-${tag}`
const output = `${root}/.deploy/wangwang-deploy-v${version}.tar.gz`

await rm(`${root}/.deploy`, { recursive: true, force: true })
await mkdir(`${stage}/assets`, { recursive: true })
await mkdir(`${stage}/migrations`, { recursive: true })
await cp(`${root}/dist/admin/wangwang/index.js`, `${stage}/worker.js`)
await cp(`${root}/dist/admin/client`, `${stage}/assets`, { recursive: true })
await cp(`${root}/drizzle`, `${stage}/migrations`, { recursive: true })
await cp(`${root}/drizzle/0000_initial.sql`, `${stage}/migration.sql`)
const assets = {}
async function collect(dir, prefix = '') {
  for (const entry of await readdir(dir)) {
    const file = `${dir}/${entry}`
    const relative = `${prefix}/${entry}`
    if ((await stat(file)).isDirectory()) await collect(file, relative)
    else assets[relative] = (await readFile(file)).toString('base64')
  }
}
await collect(`${stage}/assets`)
await writeFile(`${stage}/assets.json`, `${JSON.stringify(assets)}\n`)
await writeFile(`${stage}/manifest.json`, `${JSON.stringify({
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
  requiredSecrets: [],
}, null, 2)}\n`)
await exec('tar', ['-czf', output, '-C', `${root}/.deploy`, `wangwang-${tag}`])
console.log(output)
