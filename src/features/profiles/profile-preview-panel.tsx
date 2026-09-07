import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { ProfileNodeBinding, ProfileSlotBinding, ProfileYamlPreview, TemplateId } from '@/api/types'
import { ConfigPreviewPanel } from '@/components/config-preview-panel'
import type { ProfilePreviewResult } from './use-profile-preview'

export type ProfilePreviewPanelProps = {
  preview: ProfilePreviewResult
  loading?: boolean
  className?: string
  templateId?: TemplateId
  nodeBinding?: ProfileNodeBinding
  slotBindings?: ProfileSlotBinding[]
  onToggleCollapse?: () => void
}

export function ProfilePreviewPanel({
  preview,
  loading,
  className,
  templateId,
  nodeBinding,
  slotBindings,
  onToggleCollapse,
}: ProfilePreviewPanelProps) {
  const [viewMode, setViewMode] = useState<'groups' | 'yaml'>('groups')
  const [yamlLoading, setYamlLoading] = useState(false)
  const [yamlData, setYamlData] = useState<string>('')
  const [yamlError, setYamlError] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)

  const effectiveYamlError = !templateId ? '请先在左侧选择订阅模板' : yamlError

  useEffect(() => {
    if (viewMode !== 'yaml' || !templateId) return

    const controller = new AbortController()
    setYamlLoading(true)

    const timer = setTimeout(async () => {
      try {
        const result = await api<ProfileYamlPreview>('/profiles/preview', {
          method: 'POST',
          body: JSON.stringify({
            templateId,
            nodeBinding:
              nodeBinding?.mode === 'node'
                ? { mode: nodeBinding.mode, nodeIds: nodeBinding.nodeIds }
                : nodeBinding || { mode: 'source', sourceIds: [] },
            slotBindings:
              slotBindings?.map((binding) =>
                binding.mode === 'node'
                  ? { slotKey: binding.slotKey, mode: binding.mode, nodeIds: binding.nodeIds }
                  : binding,
              ) || [],
          }),
          signal: controller.signal,
        })
        if (!controller.signal.aborted) {
          setYamlData(result.yaml || '')
          setYamlError(result.error || null)
        }
      } catch (reason) {
        if (!controller.signal.aborted) {
          setYamlError(reason instanceof Error ? reason.message : '生成 YAML 预览失败')
          setYamlData('')
        }
      } finally {
        if (!controller.signal.aborted) {
          setYamlLoading(false)
        }
      }
    }, 250)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [viewMode, templateId, nodeBinding, slotBindings, refreshTick])

  return (
    <ConfigPreviewPanel
      className={className}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      groups={preview.groups}
      groupsLoading={loading}
      groupsEmptyText="暂无策略组数据"
      groupsEmptySubText="在左侧选择规则模板并配置节点源，此处将自动呈现"
      yaml={yamlData}
      yamlLoading={yamlLoading}
      yamlError={effectiveYamlError}
      nodeCount={preview.totalUniqueNodes}
      yamlViewTitle="查看最终编译后的 YAML 配置"
      onRefreshYaml={() => setRefreshTick((t) => t + 1)}
      onToggleCollapse={onToggleCollapse}
    />
  )
}
