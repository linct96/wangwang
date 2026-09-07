import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  FileCode2,
  Filter,
  Globe,
  Layers,
  Network,
  PanelRightClose,
  Plug,
  Radio,
  RefreshCw,
  Server,
  Sparkles,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type ConfigPreviewGroupNode = {
  id: string
  name: string
  sourceName?: string
}

export type ConfigPreviewGroup = {
  name: string
  type: string
  proxies?: string[]
  filter?: string
  excludeFilter?: string
  nodes?: ConfigPreviewGroupNode[]
  staticProxies?: string[]
  includeAllProxies?: boolean
  includeAllProviders?: boolean
}

export type ConfigPreviewSourceSlot = {
  key: string
  name: string
}

export type ConfigPreviewPanelProps = {
  className?: string
  title?: string | null
  icon?: React.ReactNode

  // 视图模式控制
  viewMode?: 'groups' | 'yaml'
  defaultViewMode?: 'groups' | 'yaml'
  onViewModeChange?: (mode: 'groups' | 'yaml') => void
  showViewModeToggle?: boolean

  // 策略组数据
  groups?: ConfigPreviewGroup[]
  groupsLoading?: boolean
  groupsEmptyText?: string
  groupsEmptySubText?: string
  sourceSlots?: ConfigPreviewSourceSlot[]

  // YAML 数据
  yaml?: string
  yamlLoading?: boolean
  yamlError?: string | null
  yamlEmptyText?: string
  yamlEmptySubText?: string
  nodeCount?: number
  onRefreshYaml?: () => void
  yamlViewTitle?: string

  // 头部工具栏扩展
  toolbarExtra?: React.ReactNode

  // 折叠面板按钮
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

export function ConfigPreviewPanel({
  className,
  title = '配置预览',
  icon,
  viewMode: controlledViewMode,
  defaultViewMode = 'groups',
  onViewModeChange,
  showViewModeToggle = true,
  groups = [],
  groupsLoading = false,
  groupsEmptyText = '暂无策略组数据',
  groupsEmptySubText = '在左侧配置规则与节点源后，此处将自动呈现',
  sourceSlots,
  yaml = '',
  yamlLoading = false,
  yamlError = null,
  yamlEmptyText = '尚未生成 YAML 配置',
  yamlEmptySubText = '请配置好节点源与模板，系统将自动渲染出最终下发配置',
  nodeCount,
  onRefreshYaml,
  yamlViewTitle = '查看最终编译后的 YAML 配置',
  toolbarExtra,
  onToggleCollapse,
}: ConfigPreviewPanelProps) {
  const [internalViewMode, setInternalViewMode] = useState<'groups' | 'yaml'>(defaultViewMode)
  const currentViewMode = controlledViewMode ?? internalViewMode

  const setViewMode = (mode: 'groups' | 'yaml') => {
    if (onViewModeChange) {
      onViewModeChange(mode)
    } else {
      setInternalViewMode(mode)
    }
  }

  const slotMap = useMemo(() => {
    return new Map((sourceSlots ?? []).map(({ key, name }) => [key, name]))
  }, [sourceSlots])

  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [copied, setCopied] = useState(false)

  const isAnyExpanded = useMemo(() => {
    if (groups.length === 0) return false
    return groups.some((g) => !collapsedGroups[g.name])
  }, [groups, collapsedGroups])

  function toggleGroup(name: string) {
    setCollapsedGroups((prev) => ({
      ...prev,
      [name]: !prev[name],
    }))
  }

  function toggleAll() {
    if (isAnyExpanded) {
      const next: Record<string, boolean> = {}
      for (const group of groups) {
        next[group.name] = true
      }
      setCollapsedGroups(next)
    } else {
      setCollapsedGroups({})
    }
  }

  async function copyYaml() {
    if (!yaml || copied) return
    try {
      await navigator.clipboard.writeText(yaml)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // 降级忽略剪贴板错误
    }
  }

  const yamlLines = yaml ? yaml.split('\n').length : 0
  const yamlSizeKb = yaml ? (new Blob([yaml]).size / 1024).toFixed(1) : '0'

  return (
    <div className={cn('config-preview-panel', className)}>
      {/* 头部导航与操作栏 */}
      <div className="preview-panel-header">
        <div className="flex items-center justify-between gap-2">
          {title ? (
            <div className="flex items-center gap-2 min-w-0">
              {icon ?? <Eye className="size-4 text-emerald-500 shrink-0" />}
              <span className="font-semibold text-sm text-foreground truncate">{title}</span>
            </div>
          ) : toolbarExtra ? (
            <div className="flex items-center gap-2 min-w-0 flex-1">{toolbarExtra}</div>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-1.5 shrink-0">
            {showViewModeToggle && (
              <div className="inline-flex items-center rounded-md bg-muted p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setViewMode('groups')}
                  className={cn(
                    'flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-all cursor-pointer',
                    currentViewMode === 'groups'
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
                    currentViewMode === 'yaml'
                      ? 'bg-background text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  title={yamlViewTitle}
                >
                  <FileCode2 className="size-3" />
                  YAML
                </button>
              </div>
            )}

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

        {title && toolbarExtra && <div className="flex items-center gap-2 pt-1 min-w-0">{toolbarExtra}</div>}
      </div>

      {/* 策略组或 YAML 内容区 */}
      <div className="preview-panel-body flex flex-col min-h-0">
        {currentViewMode === 'groups' ? (
          groupsLoading ? (
            <div className="preview-empty-state">
              <Sparkles className="size-6 text-muted-foreground/50 spin mb-2" />
              <span className="text-xs text-muted-foreground">正在解析策略组结构...</span>
            </div>
          ) : groups.length > 0 ? (
            <>
              <div className="flex items-center justify-between gap-2 pb-2 shrink-0">
                <Badge variant="secondary" className="text-[10.5px] h-4.5 px-1.5 font-normal shrink-0">
                  {groups.length} 组
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
                {groups.map((group) => {
                  const isExpanded = !collapsedGroups[group.name]
                  const groupNodes = group.nodes ?? []
                  const groupStatics = group.staticProxies ?? []
                  const totalMembers =
                    groupNodes.length +
                    groupStatics.length +
                    (group.includeAllProxies ? 1 : 0) +
                    (group.includeAllProviders ? 1 : 0)
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
                              {groupNodes.length > 0
                                ? `${groupNodes.length} 节点`
                                : group.includeAllProxies
                                  ? '全部节点'
                                  : group.includeAllProviders
                                    ? '全部集合'
                                    : `${groupStatics.length} 项`}
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* 展开内容 */}
                      {isExpanded && (
                        <div className="preview-group-card-content">
                          {/* 规则过滤提示 */}
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
                          {totalMembers > 0 ? (
                            <div className="preview-node-ref-tags">
                              {group.includeAllProxies && (
                                <div
                                  className="preview-node-tag border-dashed border-sky-500/40 bg-sky-500/10 text-sky-950 dark:text-sky-200"
                                  title="包含全部节点 (include-all-proxies)"
                                >
                                  <Globe className="size-3 text-sky-500 shrink-0" />
                                  <span className="preview-node-tag-name">包含全部节点</span>
                                </div>
                              )}
                              {group.includeAllProviders && (
                                <div
                                  className="preview-node-tag border-dashed border-indigo-500/40 bg-indigo-500/10 text-indigo-950 dark:text-indigo-200"
                                  title="包含全部代理集合 (include-all-providers)"
                                >
                                  <Boxes className="size-3 text-indigo-500 shrink-0" />
                                  <span className="preview-node-tag-name">包含全部代理集合</span>
                                </div>
                              )}
                              {groupStatics.map((sp) => {
                                const isSlot = sp.startsWith('__WANGWANG_SOURCE_SLOT_') && sp.endsWith('__')
                                const slotName = isSlot ? slotMap.get(sp) || '节点源槽位' : null
                                const isAllProxies = sp === '包含全部节点' || sp === 'include-all-proxies'
                                const isAllProviders = sp === '包含全部代理集合' || sp === 'include-all-providers'
                                const isBuiltin = sp === 'DIRECT' || sp === 'REJECT' || sp === 'GLOBAL'

                                if (isAllProxies) {
                                  return (
                                    <div
                                      key={sp}
                                      className="preview-node-tag border-dashed border-sky-500/40 bg-sky-500/10 text-sky-950 dark:text-sky-200"
                                      title="包含全部节点"
                                    >
                                      <Globe className="size-3 text-sky-500 shrink-0" />
                                      <span className="preview-node-tag-name">包含全部节点</span>
                                    </div>
                                  )
                                }

                                if (isAllProviders) {
                                  return (
                                    <div
                                      key={sp}
                                      className="preview-node-tag border-dashed border-indigo-500/40 bg-indigo-500/10 text-indigo-950 dark:text-indigo-200"
                                      title="包含全部代理集合"
                                    >
                                      <Boxes className="size-3 text-indigo-500 shrink-0" />
                                      <span className="preview-node-tag-name">包含全部代理集合</span>
                                    </div>
                                  )
                                }

                                return (
                                  <div
                                    key={sp}
                                    className={cn(
                                      'preview-node-tag',
                                      isSlot &&
                                        'border-dashed border-amber-500/45 bg-amber-500/10 text-amber-950 dark:text-amber-200',
                                    )}
                                    title={isSlot ? `节点源槽位: ${slotName} (${sp})` : sp}
                                  >
                                    {isSlot ? (
                                      <Plug className="size-3 text-amber-500 shrink-0" />
                                    ) : isBuiltin ? (
                                      <Radio className="size-3 text-emerald-500 shrink-0" />
                                    ) : (
                                      <Network className="size-3 text-blue-500 shrink-0" />
                                    )}
                                    <span className={cn('preview-node-tag-name', !isSlot && 'font-mono')}>
                                      {isSlot ? slotName : sp}
                                    </span>
                                  </div>
                                )
                              })}
                              {groupNodes.slice(0, 80).map((node, index) => (
                                <div
                                  key={`${node.id}-${index}`}
                                  className="preview-node-tag"
                                  title={`${node.name}${node.sourceName ? ` (${node.sourceName})` : ''}`}
                                >
                                  <Server className="size-3 text-purple-500 shrink-0" />
                                  <span className="preview-node-tag-name">{node.name}</span>
                                </div>
                              ))}
                              {groupNodes.length > 80 && (
                                <span className="text-[11px] text-muted-foreground self-center px-1">
                                  +{groupNodes.length - 80} 更多
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
              <p className="font-medium text-xs text-foreground">{groupsEmptyText}</p>
              <span className="text-[11px] text-muted-foreground mt-0.5">{groupsEmptySubText}</span>
            </div>
          )
        ) : (
          <div className="preview-yaml-pane">
            <div className="flex items-center justify-between gap-2 pb-2 shrink-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                {yaml ? (
                  <Badge variant="secondary" className="text-[10.5px] h-4.5 px-1.5 font-mono shrink-0">
                    {yamlLines} 行 · {yamlSizeKb} KB
                  </Badge>
                ) : null}
                {typeof nodeCount === 'number' && (
                  <Badge variant="outline" className="text-[10.5px] h-4.5 px-1.5 font-mono shrink-0">
                    {nodeCount} 节点
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {yaml && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => void copyYaml()}
                    title="复制 YAML 内容"
                    aria-label="复制 YAML 内容"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  >
                    {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                  </Button>
                )}

                {onRefreshYaml && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    disabled={yamlLoading}
                    onClick={onRefreshYaml}
                    title="刷新配置预览"
                    aria-label="刷新配置预览"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  >
                    <RefreshCw className={cn('size-3.5', yamlLoading && 'spin')} />
                  </Button>
                )}
              </div>
            </div>

            {yamlLoading ? (
              <div className="preview-empty-state flex-1">
                <Sparkles className="size-6 text-muted-foreground/50 spin mb-2" />
                <span className="text-xs text-muted-foreground">正在生成配置预览...</span>
              </div>
            ) : yamlError && !yaml ? (
              <div className="preview-empty-state flex-1">
                <AlertTriangle className="size-8 text-amber-500/60 mb-2" />
                <p className="font-medium text-xs text-foreground">{yamlError}</p>
                <span className="text-[11px] text-muted-foreground mt-0.5">请检查模板语法或关联的节点配置</span>
              </div>
            ) : yaml ? (
              <div className="preview-yaml-scroll">
                <pre>
                  <code>{yaml}</code>
                </pre>
              </div>
            ) : (
              <div className="preview-empty-state flex-1">
                <FileCode2 className="size-8 text-muted-foreground/40 mb-2" />
                <p className="font-medium text-xs text-foreground">{yamlEmptyText}</p>
                <span className="text-[11px] text-muted-foreground mt-0.5">{yamlEmptySubText}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
