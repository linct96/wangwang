import { stringify } from 'yaml'
import type { ProxyConfig } from '../db'
import { ALL_PROXIES_PLACEHOLDER, MAX_TEMPLATE_BYTES, parseTemplateYaml, validateRenderedConfig } from './validator'

export function renderMihomoConfig({
  nodes,
  template,
}: {
  nodes: Array<{ config: ProxyConfig; name: string }>
  template: { yaml: string }
}) {
  if (!nodes.length) throw new Error('配置没有可用节点')
  if (nodes.length > 1000) throw new Error('单个配置最多包含 1000 个节点')

  const config = parseTemplateYaml(template.yaml)
  const seen = new Map<string, number>()
  const proxies = nodes.map(({ config: proxy, name }) => {
    const base = name.trim() || `${proxy.server}:${proxy.port}`
    const count = (seen.get(base) || 0) + 1
    seen.set(base, count)
    return { ...proxy, name: count === 1 ? base : `${base}-${count}` }
  })
  config.proxies = proxies
  for (const group of config['proxy-groups'] as Array<Record<string, unknown>>) {
    if (!Array.isArray(group.proxies)) continue
    const filter = compileNodeFilter(group.filter, 'filter')
    const excludeFilter = compileNodeFilter(group['exclude-filter'], 'exclude-filter')
    const selected = proxies.filter(({ name }) =>
      excludeFilter.some((pattern) => pattern.test(name))
        ? false
        : filter.length === 0 || filter.some((pattern) => pattern.test(name)),
    )
    group.proxies = group.proxies.flatMap((item) =>
      item === ALL_PROXIES_PLACEHOLDER ? selected.map(({ name }) => name) : [item],
    )
  }
  validateRenderedConfig(config)
  const output = stringify(config, { lineWidth: 0 })
  if (new TextEncoder().encode(output).byteLength > MAX_TEMPLATE_BYTES) throw new Error('生成配置超过 1 MiB')
  return output
}

function compileNodeFilter(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    return value
      .split('`')
      .map((pattern) => pattern.trim())
      .filter(Boolean)
      .map((pattern) => (pattern.startsWith('(?i)') ? new RegExp(pattern.slice(4), 'i') : new RegExp(pattern)))
  } catch {
    throw new Error(`${field} 包含无效正则表达式`)
  }
}
