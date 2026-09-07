import { useEffect, useMemo, useState } from 'react'
import { parse } from 'yaml'
import { api } from '@/api/client'
import type { TemplateId, TemplatePreview as PreviewResult, TemplateSourceSlot } from '@/api/types'
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
  const [preview, setPreview] = useState<PreviewResult>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function load(signal?: AbortSignal) {
    if (isEditing) return
    setLoading(true)
    setError('')
    try {
      const result = await api<PreviewResult>('/templates/preview', {
        method: 'POST',
        body: JSON.stringify({ templateId }),
        signal,
      })
      if (!signal?.aborted) setPreview(result)
    } catch (reason) {
      if (!signal?.aborted) setError(reason instanceof Error ? reason.message : '预览生成失败')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    if (!auto || isEditing || !templateId) return
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, isEditing, templateId])

  const currentYaml = isEditing ? (yaml ?? '') : (preview?.yaml ?? '')

  const groups = useMemo<ConfigPreviewGroup[]>(() => {
    if (!currentYaml) return []
    try {
      const parsed = parse(currentYaml)
      if (!parsed || typeof parsed !== 'object') return []
      const rawGroups = Array.isArray(parsed['proxy-groups']) ? parsed['proxy-groups'] : []
      return rawGroups.map((g: Record<string, unknown>) => {
        const { includeAllProxies, includeAllProviders } = resolveProxyGroupIncludeAll(g)
        return {
          name: String(g?.name || '未命名策略组'),
          type: String(g?.type || 'select'),
          filter: typeof g?.filter === 'string' ? g.filter : undefined,
          excludeFilter: typeof g?.['exclude-filter'] === 'string' ? g['exclude-filter'] : undefined,
          proxies: Array.isArray(g?.proxies) ? g.proxies.map(String) : [],
          staticProxies: Array.isArray(g?.proxies) ? g.proxies.map(String) : [],
          nodes: [],
          includeAllProxies,
          includeAllProviders,
        }
      })
    } catch {
      return []
    }
  }, [currentYaml])

  return (
    <ConfigPreviewPanel
      className={className}
      title="配置预览"
      defaultViewMode="groups"
      groups={groups}
      sourceSlots={sourceSlots}
      groupsLoading={!isEditing && loading}
      groupsEmptyText="暂无策略组数据"
      groupsEmptySubText="当前模板尚未解析到有效 proxy-groups 策略组"
      yaml={currentYaml}
      yamlLoading={!isEditing && loading}
      yamlError={error}
      yamlEmptyText="尚未生成配置预览"
      yamlEmptySubText={isEditing ? '暂无 YAML 内容' : '点击右上角刷新按钮即可编译并生成预览'}
      nodeCount={preview?.nodeCount}
      yamlViewTitle={isEditing ? '查看当前模板 YAML 源码' : '查看最终编译后的 YAML 配置'}
      onRefreshYaml={isEditing ? undefined : () => void load()}
    />
  )
}
