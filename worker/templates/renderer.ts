import { stringify } from 'yaml'
import type { ProxyConfig } from '../db'
import { parseTemplateSourceSlots } from './source-slots'
import { MAX_TEMPLATE_BYTES, parseTemplateYaml, validateRenderedConfig } from './validator'

export type SelectedSlotNode = {
  slotKey: string
  entryId: string
  sourceId: string
  name: string
  config: ProxyConfig
}

export function renderMihomoConfig({ nodes, template }: { nodes: SelectedSlotNode[]; template: { yaml: string } }) {
  const config = parseTemplateYaml(template.yaml)
  const slots = parseTemplateSourceSlots(config)

  // 1. Build first-seen ordered unique entries by entryId
  const uniqueEntries: Array<{ entryId: string; name: string; config: ProxyConfig }> = []
  const seenEntryIds = new Set<string>()
  for (const node of nodes) {
    if (!seenEntryIds.has(node.entryId)) {
      seenEntryIds.add(node.entryId)
      uniqueEntries.push({
        entryId: node.entryId,
        name: node.name,
        config: node.config,
      })
    }
  }

  if (!uniqueEntries.length) throw new Error('配置没有可用节点')
  if (uniqueEntries.length > 1000) throw new Error('单个配置最多包含 1000 个节点')

  // 2. Assign final unique names using base, base-2, base-3
  const seenNames = new Map<string, number>()
  const entryIdToFinalName = new Map<string, string>()
  const rootProxies = uniqueEntries.map(({ entryId, name, config: proxy }) => {
    const base = name.trim() || `${proxy.server}:${proxy.port}`
    const count = (seenNames.get(base) || 0) + 1
    seenNames.set(base, count)
    const finalName = count === 1 ? base : `${base}-${count}`
    entryIdToFinalName.set(entryId, finalName)
    return { ...proxy, name: finalName }
  })
  config.proxies = rootProxies

  // 3. Build ordered slotKey -> finalName[] from selected nodes
  const slotMembers = new Map<string, string[]>()
  for (const slot of slots) {
    slotMembers.set(slot.key, [])
  }
  for (const node of nodes) {
    const list = slotMembers.get(node.slotKey)
    if (list) {
      const finalName = entryIdToFinalName.get(node.entryId)
      if (finalName && !list.includes(finalName)) {
        list.push(finalName)
      }
    }
  }

  // 4. Expand groups slot-by-slot and stable-dedupe
  const slotKeySet = new Set(slots.map((s) => s.key))
  const groups = config['proxy-groups'] as Array<Record<string, unknown>>
  for (const group of groups) {
    if (!Array.isArray(group.proxies)) continue
    const filter = compileNodeFilter(group.filter, 'filter')
    const excludeFilter = compileNodeFilter(group['exclude-filter'], 'exclude-filter')
    const expanded: string[] = []

    for (const member of group.proxies) {
      if (typeof member === 'string' && slotKeySet.has(member)) {
        const slotProxyNames = slotMembers.get(member) ?? []
        const filtered = slotProxyNames.filter((name) =>
          excludeFilter.some((pattern) => pattern.test(name))
            ? false
            : filter.length === 0 || filter.some((pattern) => pattern.test(name)),
        )
        expanded.push(...filtered)
      } else if (typeof member === 'string') {
        expanded.push(member)
      }
    }

    // Stable-dedupe without changing first occurrence order
    group.proxies = [...new Set(expanded)]
  }

  // 5. Delete x-wangwang before validateRenderedConfig and stringify
  delete config['x-wangwang']

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
