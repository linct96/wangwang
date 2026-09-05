import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Eye,
  FileCode2,
  Filter,
  Layers,
  Network,
  PanelRightClose,
  Radio,
  RefreshCw,
  Server,
  Sparkles,
} from 'lucide-react'
import { api } from '@/api/client'
import type { ProfileNodeBinding, ProfileSlotBinding, ProfileYamlPreview, TemplateId } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ProfilePreviewResult } from './use-profile-preview'

type ProfilePreviewPanelProps = {
  preview: ProfilePreviewResult
  loading?: boolean
  className?: string
  templateId?: TemplateId
  nodeBinding?: ProfileNodeBinding
  slotBindings?: ProfileSlotBinding[]
  tags?: string[]
  onToggleCollapse?: () => void
}

function groupTypeBadgeVariant(type: string) {
  switch (type.toLowerCase()) {
    case 'select':
      return 'default'
    case 'url-test':
      return 'secondary'
    case 'fallback':
      return 'outline'
    default:
      return 'secondary'
  }
}

export function ProfilePreviewPanel({
  preview,
  loading,
  className,
  templateId,
  nodeBinding,
  slotBindings,
  tags,
  onToggleCollapse,
}: ProfilePreviewPanelProps) {
  const [viewMode, setViewMode] = useState<'groups' | 'yaml'>('groups')
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})

  // 切换模板时重置折叠状态
  useEffect(() => {
    setCollapsedGroups({})
  }, [templateId])

  // 是否存在任意展开的分组；若全部手动收起则自动为 false
  const isAnyExpanded = useMemo(() => {
    if (preview.groups.length === 0) return false
    return preview.groups.some((g) => !collapsedGroups[g.name])
  }, [preview.groups, collapsedGroups])

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
            nodeBinding: nodeBinding || { mode: 'source', sourceIds: [] },
            slotBindings: slotBindings || [],
            tags: tags || [],
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
  }, [viewMode, templateId, nodeBinding, slotBindings, tags, refreshTick])

  function toggleGroup(name: string) {
    setCollapsedGroups((prev) => {
      const isCurrentlyCollapsed = !!prev[name]
      return {
        ...prev,
        [name]: !isCurrentlyCollapsed,
      }
    })
  }

  function toggleAll() {
    if (isAnyExpanded) {
      // 当前有展开项时，全部折叠
      const next: Record<string, boolean> = {}
      for (const group of preview.groups) {
        next[group.name] = true
      }
      setCollapsedGroups(next)
    } else {
      // 当前全部收起时，全部展开
      setCollapsedGroups({})
    }
  }

  const yamlLines = yamlData ? yamlData.split('\n').length : 0
  const yamlSizeKb = yamlData ? (new Blob([yamlData]).size / 1024).toFixed(1) : '0'

  return (
    <div className={cn('profile-preview-panel', className)}>
      {/* 头部摘要 */}
      <div className="preview-panel-header">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Eye className="size-4 text-emerald-500 shrink-0" />
            <span className="font-semibold text-sm text-foreground truncate">配置预览</span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <div className="inline-flex items-center rounded-md bg-muted p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setViewMode('groups')}
                className={cn(
                  'flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-all cursor-pointer',
                  viewMode === 'groups'
                    ? 'bg-background text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                title="查看策略组可视化结构与节点解析"
              >
                <Network className="size-3" />
                可视化
              </button>
              <button
                type="button"
                onClick={() => setViewMode('yaml')}
                className={cn(
                  'flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-all cursor-pointer',
                  viewMode === 'yaml'
                    ? 'bg-background text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                title="查看最终编译后的 YAML 文件源文件"
              >
                <FileCode2 className="size-3" />
                YAML
              </button>
            </div>

            {onToggleCollapse && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={onToggleCollapse}
                title="向右收起预览面板"
                aria-label="收起预览面板"
                className="h-6 w-6 text-muted-foreground hover:text-foreground hidden lg:inline-flex"
              >
                <PanelRightClose className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* 策略组或 YAML 容器 */}
      <div className="preview-panel-body flex flex-col min-h-0">
        {viewMode === 'groups' ? (
          loading ? (
            <div className="preview-empty-state">
              <Sparkles className="size-6 text-muted-foreground/50 spin mb-2" />
              <span className="text-xs text-muted-foreground">正在解析模板结构...</span>
            </div>
          ) : preview.groups.length > 0 ? (
            <>
              <div className="flex items-center justify-between gap-2 pb-2 shrink-0">
                <Badge variant="secondary" className="text-[10.5px] h-4.5 px-1.5 font-normal shrink-0">
                  {preview.groups.length} 组
                </Badge>

                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={toggleAll}
                  className="text-[11px] h-6 px-1.5 text-muted-foreground hover:text-foreground"
                >
                  {isAnyExpanded ? '折叠全部' : '展开全部'}
                </Button>
              </div>

              <div className="preview-groups-container">
                {preview.groups.map((group) => {
                  const isExpanded = !collapsedGroups[group.name]
                  const totalMembers = group.nodes.length + group.staticProxies.length
                  const isEmpty = totalMembers === 0

                  return (
                    <div key={group.name} className={cn('preview-group-card', isEmpty && 'preview-group-card-empty')}>
                      {/* 卡片头部 */}
                      <div className="preview-group-card-header" onClick={() => toggleGroup(group.name)}>
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <button
                            type="button"
                            aria-label={isExpanded ? '折叠' : '展开'}
                            className="text-muted-foreground hover:text-foreground shrink-0"
                          >
                            {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                          </button>
                          <span className="font-medium text-xs text-foreground truncate" title={group.name}>
                            {group.name}
                          </span>
                          <Badge variant={groupTypeBadgeVariant(group.type)} className="text-[10px] h-4 px-1 shrink-0">
                            {group.type}
                          </Badge>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {isEmpty ? (
                            <Badge variant="destructive" className="text-[10px] h-4.5 px-1.5">
                              0 节点
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[11px] h-4.5 px-1.5 font-mono">
                              {group.nodes.length} 节点
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* 展开内容 */}
                      {isExpanded && (
                        <div className="preview-group-card-content">
                          {/* 规则过滤提示（若有） */}
                          {(group.filter || group.excludeFilter) && (
                            <div className="preview-group-filter-banner">
                              <Filter className="size-3 text-muted-foreground shrink-0" />
                              <span className="text-[10.5px] text-muted-foreground truncate">
                                {group.filter && `包含: ${group.filter}`}
                                {group.filter && group.excludeFilter && ' · '}
                                {group.excludeFilter && `排除: ${group.excludeFilter}`}
                              </span>
                            </div>
                          )}

                          {/* 静态代理引用与节点 Tag 列表 */}
                          {group.staticProxies.length > 0 || group.nodes.length > 0 ? (
                            <div className="preview-node-ref-tags">
                              {group.staticProxies.map((sp) => {
                                const isBuiltin = sp === 'DIRECT' || sp === 'REJECT' || sp === 'GLOBAL'
                                return (
                                  <div key={sp} className="preview-node-tag" title={sp}>
                                    {isBuiltin ? (
                                      <Radio className="size-3 text-emerald-500 shrink-0" />
                                    ) : (
                                      <Network className="size-3 text-blue-500 shrink-0" />
                                    )}
                                    <span className="preview-node-tag-name font-mono">{sp}</span>
                                  </div>
                                )
                              })}
                              {group.nodes.slice(0, 80).map((node) => (
                                <div
                                  key={node.id}
                                  className="preview-node-tag"
                                  title={`${node.name}${node.sourceName ? ` (${node.sourceName})` : ''}`}
                                >
                                  <Server className="size-3 text-purple-500 shrink-0" />
                                  <span className="preview-node-tag-name">{node.name}</span>
                                </div>
                              ))}
                              {group.nodes.length > 80 && (
                                <span className="text-[11px] text-muted-foreground self-center px-1">
                                  +{group.nodes.length - 80} 更多
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="preview-empty-group-note">
                              <span>当前未选择节点，或被该组的正则过滤规则全部过滤。</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          ) : (
            <div className="preview-empty-state">
              <Layers className="size-8 text-muted-foreground/40 mb-2" />
              <p className="font-medium text-xs text-foreground">暂无策略组数据</p>
              <span className="text-[11px] text-muted-foreground mt-0.5">
                在左侧选择规则模板并配置节点源，此处将自动呈现
              </span>
            </div>
          )
        ) : (
          <div className="preview-yaml-pane">
            <div className="flex items-center justify-between gap-2 pb-2 shrink-0">
              <div>
                {yamlData ? (
                  <Badge variant="secondary" className="text-[10.5px] h-4.5 px-1.5 font-mono shrink-0">
                    {yamlLines} 行 · {yamlSizeKb} KB
                  </Badge>
                ) : null}
              </div>

              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={yamlLoading}
                onClick={() => setRefreshTick((t) => t + 1)}
                title="刷新 YAML 预览"
                aria-label="刷新 YAML 预览"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className={cn('size-3.5', yamlLoading && 'spin')} />
              </Button>
            </div>

            {yamlLoading && !yamlData ? (
              <div className="preview-empty-state flex-1">
                <Sparkles className="size-6 text-muted-foreground/50 spin mb-2" />
                <span className="text-xs text-muted-foreground">正在编译并生成 YAML 预览...</span>
              </div>
            ) : effectiveYamlError && !yamlData ? (
              <div className="preview-empty-state flex-1">
                <AlertTriangle className="size-8 text-amber-500/60 mb-2" />
                <p className="font-medium text-xs text-foreground">{effectiveYamlError}</p>
                <span className="text-[11px] text-muted-foreground mt-0.5">请在左侧选择模板并绑定可用节点源</span>
              </div>
            ) : yamlData ? (
              <div className="preview-yaml-scroll">
                <pre>
                  <code>{yamlData}</code>
                </pre>
              </div>
            ) : (
              <div className="preview-empty-state flex-1">
                <FileCode2 className="size-8 text-muted-foreground/40 mb-2" />
                <p className="font-medium text-xs text-foreground">尚未生成 YAML 配置</p>
                <span className="text-[11px] text-muted-foreground mt-0.5">
                  请配置好节点源与模板，系统将自动渲染出最终下发配置
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
