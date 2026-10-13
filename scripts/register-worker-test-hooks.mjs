import { readFileSync, readdirSync } from 'node:fs'
import { registerHooks } from 'node:module'

const builtinFilesUrl = new URL('../worker/templates/builtin-files.ts', import.meta.url)
const presetsUrl = new URL('../worker/templates/presets/', import.meta.url)

// Node 测试复用真实 YAML，仅替代 Vite 专属的文件收集入口。
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL?.includes('/worker/') && !specifier.endsWith('.ts'))
      specifier += '.ts'
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url !== builtinFilesUrl.href) return nextLoad(url, context)
    const files = Object.fromEntries(
      readdirSync(presetsUrl)
        .filter((name) => /\.(yaml|yml)$/.test(name))
        .map((name) => [`./presets/${name}`, readFileSync(new URL(name, presetsUrl), 'utf8')]),
    )
    return { format: 'module', source: `export default ${JSON.stringify(files)}`, shortCircuit: true }
  },
})
