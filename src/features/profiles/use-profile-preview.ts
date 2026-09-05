import { useMemo } from 'react'
import { parse } from 'yaml'
import type { NodeOption, ProfileNodeBinding, ProfileSlotBinding, TemplateDetail } from '@/api/types'

export type ResolvedProxyGroup = {
  name: string
  type: string
  proxies: string[]
  filter?: string
  excludeFilter?: string
  nodes: NodeOption[]
  staticProxies: string[]
}

export type ProfilePreviewResult = {
  groups: ResolvedProxyGroup[]
  totalUniqueNodes: number
  emptyGroupCount: number
}

function compileFilter(patternStr?: unknown): RegExp[] {
  if (typeof patternStr !== 'string' || !patternStr.trim()) return []
  return patternStr
    .split('`')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => {
      try {
        if (p.startsWith('(?i)')) {
          return new RegExp(p.slice(4), 'i')
        }
        return new RegExp(p)
      } catch {
        return null
      }
    })
    .filter((r): r is RegExp => r !== null)
}

export function useProfilePreview(
  template: TemplateDetail | undefined,
  nodeBinding: ProfileNodeBinding,
  slotBindings: ProfileSlotBinding[],
  allNodes: NodeOption[],
): ProfilePreviewResult {
  return useMemo(() => {
    if (!template?.yaml) {
      return { groups: [], totalUniqueNodes: 0, emptyGroupCount: 0 }
    }

    let config: Record<string, unknown>
    try {
      config = parse(template.yaml)
    } catch {
      return { groups: [], totalUniqueNodes: 0, emptyGroupCount: 0 }
    }

    const rawGroups = (Array.isArray(config['proxy-groups']) ? config['proxy-groups'] : []) as Array<
      Record<string, unknown>
    >

    const nodesById = new Map(allNodes.map((node) => [node.id, node]))
    const resolveBinding = (binding: ProfileNodeBinding) => {
      if (binding.mode === 'node')
        return binding.nodeIds
          .map((id) => nodesById.get(id))
          .filter((node): node is NodeOption => Boolean(node?.enabled && node.sourceEnabled))
      if (binding.mode === 'tag') {
        const selectedTags = new Set(binding.tags.map((tag) => tag.toLocaleLowerCase()))
        let filtered = allNodes.filter(
          (node) =>
            node.enabled && node.sourceEnabled && node.tags.some((tag) => selectedTags.has(tag.toLocaleLowerCase())),
        )
        try {
          if (binding.includeRegex) {
            const include = new RegExp(binding.includeRegex)
            filtered = filtered.filter((node) => include.test(node.name))
          }
          if (binding.excludeRegex) {
            const exclude = new RegExp(binding.excludeRegex)
            filtered = filtered.filter((node) => !exclude.test(node.name))
          }
        } catch {
          // 表单校验会显示无效正则，预览暂时忽略它。
        }
        return filtered
      }
      const selectedSourceIds = new Set(binding.sourceIds)
      let filtered = allNodes.filter(
        (node) => node.enabled && node.sourceEnabled && selectedSourceIds.has(node.sourceId),
      )
      try {
        if (binding.includeRegex) {
          const include = new RegExp(binding.includeRegex)
          filtered = filtered.filter((node) => include.test(node.name))
        }
        if (binding.excludeRegex) {
          const exclude = new RegExp(binding.excludeRegex)
          filtered = filtered.filter((node) => !exclude.test(node.name))
        }
      } catch {
        // 表单校验会显示无效正则，预览暂时忽略它。
      }
      return filtered
    }

    const resolvedSlots = new Map(slotBindings.map((binding) => [binding.slotKey, resolveBinding(binding)]))
    const slotMap = new Map(template.sourceSlots.map(({ key }) => [key, resolvedSlots.get(key) || []]))
    const selectedNodesMap = new Map<string, NodeOption>()
    for (const node of [resolveBinding(nodeBinding), ...slotMap.values()].flat())
      if (!selectedNodesMap.has(node.physicalNodeId)) selectedNodesMap.set(node.physicalNodeId, node)
    const selectedNodes = [...selectedNodesMap.values()]
    const allUniqueNodeIds = new Set(selectedNodes.map(({ id }) => id))
    const groups: ResolvedProxyGroup[] = rawGroups.map((g) => {
      const includeFilters = compileFilter(g.filter)
      const excludeFilters = compileFilter(g['exclude-filter'])
      const matchesGroup = (node: NodeOption) =>
        (!includeFilters.length || includeFilters.some((reg) => reg.test(node.name))) &&
        !excludeFilters.some((reg) => reg.test(node.name))
      const resolvedNodes: NodeOption[] = []
      const staticProxies: string[] = []
      const proxiesList = Array.isArray(g.proxies) ? g.proxies : []

      for (const proxyItem of proxiesList) {
        const itemKey = String(proxyItem)
        if (slotMap.has(itemKey)) resolvedNodes.push(...(slotMap.get(itemKey) || []).filter(matchesGroup))
        else staticProxies.push(itemKey)
      }
      const includeAllProxies =
        typeof g['include-all-proxies'] === 'boolean' ? g['include-all-proxies'] : g['include-all'] === true
      if (includeAllProxies)
        resolvedNodes.push(
          ...selectedNodes
            .filter(matchesGroup)
            .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0)),
        )

      return {
        name: String(g.name || '未命名策略组'),
        type: String(g.type || 'select'),
        proxies: proxiesList.map(String),
        filter: typeof g.filter === 'string' ? g.filter : undefined,
        excludeFilter: typeof g['exclude-filter'] === 'string' ? g['exclude-filter'] : undefined,
        nodes: resolvedNodes,
        staticProxies,
      }
    })

    const emptyGroupCount = groups.filter((g) => g.nodes.length === 0 && g.staticProxies.length === 0).length

    return {
      groups,
      totalUniqueNodes: allUniqueNodeIds.size,
      emptyGroupCount,
    }
  }, [template, nodeBinding, slotBindings, allNodes])
}
