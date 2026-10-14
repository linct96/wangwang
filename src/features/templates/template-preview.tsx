import { useEffect, useMemo, useState } from 'react'
import { parse } from 'yaml'
import { api } from '@/api/client'
import type { TemplateDetail, TemplateId, TemplatePreview as PreviewResult, TemplateSourceSlot } from '@/api/types'
import { ConfigPreviewPanel } from '@/components/config-preview-panel'
import type { ConfigPreviewGroup } from '@/components/config-preview-panel'
import { resolveProxyGroupIncludeAll } from '@/lib/mihomo'

export function TemplatePreview({
  templateId,
  yaml,
  sourceSlots,
  auto = false,
  className,
}: {
  templateId?: TemplateId
  yaml?: string
  sourceSlots?: TemplateSourceSlot[]
  auto?: boolean
  className?: string
}) {
  const isEditing = yaml !== undefined
  const [preview, setPreview] = useState<PreviewResult & { template: Pick<TemplateDetail, 'yaml' | 'sourceSlots'> }>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function load(signal?: AbortSignal) {
    setLoading(true)
    setError('')
    try {
      const template = isEditing
        ? { yaml, sourceSlots: sourceSlots || [] }
        : await api<TemplateDetail>(`/templates/${templateId}`, { signal })
      const result = await api<PreviewResult>('/templates/preview', {
        method: 'POST',
        body: JSON.stringify({ yaml: template.yaml, sourceSlots: template.sourceSlots }),
        signal,
      })
      if (!signal?.aborted) setPreview({ ...result, template })
    } catch (reason) {
      if (!signal?.aborted) {
        setPreview(undefined)
        setError(reason instanceof Error ? reason.message : '预览生成失败')
      }
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    if (!isEditing && (!auto || !templateId)) return
    const controller = new AbortController()
    setLoading(true)
    const timer = setTimeout(() => void load(controller.signal), 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, isEditing, templateId, yaml, sourceSlots])

  const currentYaml = preview?.yaml ?? ''
  // 标签保留模板槽位身份，编译 YAML 中的示例节点只用于 YAML 预览。
  const templateYaml = preview?.template.yaml ?? yaml ?? ''

  const groups = useMemo<ConfigPreviewGroup[]>(() => {
    if (!templateYaml) return []
    try {
      const parsed = parse(templateYaml)
      if (!parsed || typeof parsed !== 'object') return []
      const rawGroups = Array.isArray(parsed['proxy-groups']) ? parsed['proxy-groups'] : []
      return rawGroups.map((g: Record<string, unknown>) => {
        const { includeAllProxies, includeAllProviders } = resolveProxyGroupIncludeAll(g)
        return {
          name: String(g?.name || '未命名策略组'),
          type: String(g?.type || 'select'),
          filter: typeof g?.filter === 'string' ? g.filter : undefined,
          excludeFilter: typeof g?.['exclude-filter'] === 'string' ? g['exclude-filter'] : undefined,
          staticProxies: Array.isArray(g?.proxies) ? g.proxies.map(String) : [],
          nodes: [],
          use: Array.isArray(g.use) ? g.use.map(String) : [],
          includeAllProxies,
          includeAllProviders,
        }
      })
    } catch {
      return []
    }
  }, [templateYaml])

  return (
    <ConfigPreviewPanel
      className={className}
      title="配置预览"
      defaultViewMode="groups"
      groups={groups}
      sourceSlots={preview?.template.sourceSlots ?? sourceSlots}
      groupsLoading={loading}
      groupsEmptyText="暂无策略组数据"
      groupsEmptySubText="当前模板尚未解析到有效 proxy-groups 策略组"
      yaml={currentYaml}
      yamlLoading={loading}
      yamlError={error}
      yamlEmptyText="尚未生成配置预览"
      yamlEmptySubText={isEditing ? '暂无 YAML 内容' : '点击右上角刷新按钮即可编译并生成预览'}
      nodeCount={preview?.nodeCount}
      yamlViewTitle={isEditing ? '查看示例编译 YAML（订阅地址为示例）' : '查看最终编译后的 YAML 配置'}
      onRefreshYaml={isEditing ? undefined : () => void load()}
    />
  )
}
