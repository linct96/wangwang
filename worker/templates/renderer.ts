import { stringify } from 'yaml'
import { compileRegexFilters, REGEX_ERROR } from '../../shared/regex'
import type { PhysicalProxyConfig } from '../db'
import { slotProviderName, type TemplateSourceSlot } from './source-slots'
import type { ProfileProxyProviders } from '../profile-proxy-providers'
import { MAX_TEMPLATE_BYTES, parseTemplateYaml, validateRenderedConfig } from './validator'

export type SelectedNode = {
  nodeId: string
  physicalNodeId: string
  name: string
  config: PhysicalProxyConfig
}

export type SelectedSlotNode = SelectedNode & { slotKey: string }

export function renderMihomoConfig({
  globalNodes,
  slotNodes,
  template,
  proxyProviders = {},
}: {
  globalNodes: SelectedNode[]
  slotNodes: SelectedSlotNode[]
  template: { yaml: string; sourceSlots: TemplateSourceSlot[] }
  proxyProviders?: ProfileProxyProviders
}) {
  const slots = template.sourceSlots
  const config = parseTemplateYaml(template.yaml, slots)
  const existing = config['proxy-providers']
  if (existing !== undefined && (!existing || typeof existing !== 'object' || Array.isArray(existing)))
    throw new Error('模板 proxy-providers 必须是对象')
  for (const name of Object.keys(proxyProviders))
    if (existing && Object.hasOwn(existing, name)) throw new Error(`代理集合名称与模板冲突：${name}`)
  if (Object.keys(proxyProviders).length)
    config['proxy-providers'] = { ...(existing as Record<string, unknown>), ...proxyProviders }
  const subscriptionKeys = new Set(slots.filter(({ type }) => type === 'subscription').map(({ key }) => key))
  for (const key of subscriptionKeys)
    if (!Object.hasOwn(proxyProviders, slotProviderName(key))) throw new Error(`订阅源槽位未绑定：${key}`)
  const orderedSlotNodes = slots
    .filter(({ type }) => type !== 'subscription')
    .flatMap(({ key }) => slotNodes.filter((node) => node.slotKey === key))
  const uniqueNodes = [
    ...[...globalNodes, ...orderedSlotNodes]
      .reduce(
        (seen, node) => seen.set(node.physicalNodeId, seen.get(node.physicalNodeId) || node),
        new Map<string, SelectedNode>(),
      )
      .values(),
  ]
  if (!uniqueNodes.length && !Object.keys(config['proxy-providers'] || {}).length) throw new Error('配置没有可用节点')
  if (uniqueNodes.length > 1000) throw new Error('单个配置最多包含 1000 个节点')

  const seenNames = new Map<string, number>()
  const names = new Map<string, string>()
  config.proxies = uniqueNodes.map(({ physicalNodeId, config: proxy, name }) => {
    const base = name.trim() || `${proxy.server}:${proxy.port}`
    const count = (seenNames.get(base) || 0) + 1
    seenNames.set(base, count)
    const finalName = count === 1 ? base : `${base}-${count}`
    names.set(physicalNodeId, finalName)
    return { ...proxy, name: finalName }
  })

  const members = new Map(slots.map(({ key }) => [key, [] as string[]]))
  for (const node of orderedSlotNodes) {
    const name = names.get(node.physicalNodeId)
    const slot = members.get(node.slotKey)
    if (name && slot && !slot.includes(name)) slot.push(name)
  }

  for (const group of config['proxy-groups'] as Array<Record<string, unknown>>) {
    if (Array.isArray(group.use))
      group.use = [...new Set(group.use.map((item) => (subscriptionKeys.has(item) ? slotProviderName(item) : item)))]
    if (!Array.isArray(group.proxies)) continue
    const filter = compileNodeFilter(group.filter, 'filter')
    const exclude = compileNodeFilter(group['exclude-filter'], 'exclude-filter')
    const matches = (name: string) =>
      !exclude.some((pattern) => pattern.test(name)) && (!filter.length || filter.some((pattern) => pattern.test(name)))
    const expanded = group.proxies.flatMap((item) => {
      const slot = typeof item === 'string' ? members.get(item) : undefined
      return slot ? slot.filter(matches) : [item]
    })
    group.proxies = [...new Set(expanded)]
  }

  validateRenderedConfig(config)
  const output = stringify(config, { lineWidth: 0 })
  if (new TextEncoder().encode(output).byteLength > MAX_TEMPLATE_BYTES) throw new Error('生成配置超过 1 MiB')
  return output
}

function compileNodeFilter(value: unknown, field: string) {
  try {
    return compileRegexFilters(value)
  } catch {
    throw new Error(`${field}：${REGEX_ERROR}`)
  }
}
