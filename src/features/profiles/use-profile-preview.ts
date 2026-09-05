import { useMemo } from 'react'
import { parse } from 'yaml'
import type { NodeOption, ProfileSlotBinding, TemplateDetail } from '@/api/types'

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

    // 1. 各槽位分配的节点集合
    const slotMap = new Map<string, NodeOption[]>()
    const nodesById = new Map(allNodes.map((n) => [n.id, n]))

    for (const binding of slotBindings) {
      if (binding.mode === 'source') {
        const selectedSourceIds = new Set(binding.sourceIds)
        let filtered = allNodes.filter((n) => n.enabled && n.sourceEnabled && selectedSourceIds.has(n.sourceId))
        if (binding.includeRegex) {
          try {
            const inc = new RegExp(binding.includeRegex)
            filtered = filtered.filter((n) => inc.test(n.name))
          } catch {
            // 正则无效则不应用
          }
        }
        if (binding.excludeRegex) {
          try {
            const exc = new RegExp(binding.excludeRegex)
            filtered = filtered.filter((n) => !exc.test(n.name))
          } catch {
            // 正则无效则不应用
          }
        }
        slotMap.set(binding.slotKey, filtered)
      } else if (binding.mode === 'node') {
        const directNodes = binding.nodeIds
          .map((id) => nodesById.get(id))
          .filter((n): n is NodeOption => Boolean(n && n.enabled && n.sourceEnabled))
        slotMap.set(binding.slotKey, directNodes)
      }
    }

    // 2. 映射到每个 proxy-group
    const allUniqueNodeIds = new Set<string>()
    const groups: ResolvedProxyGroup[] = rawGroups.map((g) => {
      const includeFilters = compileFilter(g.filter)
      const excludeFilters = compileFilter(g['exclude-filter'])
      const resolvedNodes: NodeOption[] = []
      const staticProxies: string[] = []
      const proxiesList = Array.isArray(g.proxies) ? g.proxies : []

      for (const proxyItem of proxiesList) {
        const itemKey = String(proxyItem)
        if (slotMap.has(itemKey)) {
          const slotNodes = slotMap.get(itemKey) || []
          for (const node of slotNodes) {
            const matchesInc = !includeFilters.length || includeFilters.some((reg) => reg.test(node.name))
            const matchesExc = excludeFilters.length > 0 && excludeFilters.some((reg) => reg.test(node.name))
            if (matchesInc && !matchesExc) {
              resolvedNodes.push(node)
              allUniqueNodeIds.add(node.id)
            }
          }
        } else {
          staticProxies.push(itemKey)
        }
      }

      // 去重保序
      const uniqueNodesMap = new Map<string, NodeOption>()
      for (const n of resolvedNodes) {
        if (!uniqueNodesMap.has(n.id)) uniqueNodesMap.set(n.id, n)
      }

      return {
        name: String(g.name || '未命名策略组'),
        type: String(g.type || 'select'),
        proxies: proxiesList.map(String),
        filter: typeof g.filter === 'string' ? g.filter : undefined,
        excludeFilter: typeof g['exclude-filter'] === 'string' ? g['exclude-filter'] : undefined,
        nodes: Array.from(uniqueNodesMap.values()),
        staticProxies,
      }
    })

    const emptyGroupCount = groups.filter((g) => g.nodes.length === 0 && g.staticProxies.length === 0).length

    return {
      groups,
      totalUniqueNodes: allUniqueNodeIds.size,
      emptyGroupCount,
    }
  }, [template, slotBindings, allNodes])
}
