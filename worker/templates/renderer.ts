import { stringify } from 'yaml'
import type { PhysicalProxyConfig } from '../db'
import type { TemplateSourceSlot } from './source-slots'
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
}: {
  globalNodes: SelectedNode[]
  slotNodes: SelectedSlotNode[]
  template: { yaml: string; sourceSlots: TemplateSourceSlot[] }
}) {
  const slots = template.sourceSlots
  const config = parseTemplateYaml(template.yaml, slots)
  const uniqueNodes = [
    ...[...globalNodes, ...slotNodes]
      .reduce(
        (seen, node) => seen.set(node.physicalNodeId, seen.get(node.physicalNodeId) || node),
        new Map<string, SelectedNode>(),
      )
      .values(),
  ]
  if (!uniqueNodes.length) throw new Error('配置没有可用节点')
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
  for (const node of slotNodes) {
    const name = names.get(node.physicalNodeId)
    const slot = members.get(node.slotKey)
    if (name && slot && !slot.includes(name)) slot.push(name)
  }

  for (const group of config['proxy-groups'] as Array<Record<string, unknown>>) {
    if (!Array.isArray(group.proxies)) continue
    const filter = compileNodeFilter(group.filter, 'filter')
    const exclude = compileNodeFilter(group['exclude-filter'], 'exclude-filter')
    const expanded = group.proxies.flatMap((item) => {
      const slot = typeof item === 'string' ? members.get(item) : undefined
      return slot
        ? slot.filter(
            (name) =>
              !exclude.some((pattern) => pattern.test(name)) && (!filter.length || filter.some((p) => p.test(name))),
          )
        : [item]
    })
    group.proxies = [...new Set(expanded)]
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
