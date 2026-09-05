import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Filter,
  Layers,
  Network,
  PanelRightClose,
  Search,
  Sparkles,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { ProfilePreviewResult } from './use-profile-preview'

type ProfilePreviewPanelProps = {
  preview: ProfilePreviewResult
  loading?: boolean
  templateName?: string
  className?: string
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
  templateName,
  className,
  onToggleCollapse,
}: ProfilePreviewPanelProps) {
  const [search, setSearch] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})
  const [allExpanded, setAllExpanded] = useState(true)

  const normalizedSearch = search.trim().toLowerCase()

  const filteredGroups = useMemo(() => {
    if (!normalizedSearch) return preview.groups
    return preview.groups.filter((group) => {
      const matchGroupName = group.name.toLowerCase().includes(normalizedSearch)
      const matchNode = group.nodes.some((n) => n.name.toLowerCase().includes(normalizedSearch))
      const matchStatic = group.staticProxies.some((p) => p.toLowerCase().includes(normalizedSearch))
      return matchGroupName || matchNode || matchStatic
    })
  }, [preview.groups, normalizedSearch])

  function toggleGroup(name: string) {
    setExpandedGroups((prev) => {
      const current = prev[name] !== undefined ? prev[name] : allExpanded
      return { ...prev, [name]: !current }
    })
  }

  function toggleAll() {
    const next = !allExpanded
    setAllExpanded(next)
    setExpandedGroups({})
  }

  return (
    <div className={cn('profile-preview-panel', className)}>
      {/* 头部摘要 */}
      <div className="preview-panel-header">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="preview-header-icon">
              <Network className="size-4 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-foreground">实时代理组预览</span>
                <Badge variant="secondary" className="text-[11px] h-4.5 px-1.5 font-normal">
                  {preview.groups.length} 个策略组
                </Badge>
              </div>
              <span className="text-[11px] text-muted-foreground truncate block">
                {templateName ? `基于 ${templateName} 模板实时解析` : '根据当前规则与槽位配置动态计算'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={toggleAll}
              className="text-[11px] h-6 px-2 text-muted-foreground hover:text-foreground"
            >
              {allExpanded ? '折叠全部' : '展开全部'}
            </Button>
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

        {/* 统计胶囊 */}
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <div className="preview-stat-chip">
            <span className="text-muted-foreground text-[11px]">覆盖独立节点:</span>
            <strong className="text-xs font-semibold text-foreground ml-1">{preview.totalUniqueNodes}</strong>
          </div>
          {preview.emptyGroupCount > 0 && (
            <div className="preview-stat-chip preview-stat-chip-warn">
              <AlertTriangle className="size-3 text-amber-500 mr-1" />
              <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                {preview.emptyGroupCount} 个策略组暂无匹配节点
              </span>
            </div>
          )}
        </div>

        {/* 搜索框 */}
        <div className="relative pt-2">
          <Search className="absolute left-2.5 top-[calc(50%+4px)] -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索策略组、节点名称或目标..."
            className="pl-8 h-7.5 text-xs bg-card"
          />
        </div>
      </div>

      {/* 策略组列表 */}
      <div className="preview-panel-body">
        {loading ? (
          <div className="preview-empty-state">
            <Sparkles className="size-6 text-muted-foreground/50 spin mb-2" />
            <span className="text-xs text-muted-foreground">正在解析模板结构...</span>
          </div>
        ) : filteredGroups.length > 0 ? (
          <div className="preview-groups-container">
            {filteredGroups.map((group) => {
              const isExpanded = expandedGroups[group.name] !== undefined ? expandedGroups[group.name] : allExpanded
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

                      {/* 静态代理引用 (DIRECT, REJECT, 其他组) */}
                      {group.staticProxies.length > 0 && (
                        <div className="preview-static-proxies-wrap">
                          {group.staticProxies.map((sp) => (
                            <span key={sp} className="preview-static-chip">
                              {sp}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* 实际展开的节点列表 */}
                      {group.nodes.length > 0 ? (
                        <div className="preview-node-list">
                          {group.nodes.slice(0, 40).map((node, idx) => (
                            <div key={node.id} className="preview-node-row">
                              <span className="preview-node-idx">{idx + 1}</span>
                              <span className="preview-node-name truncate" title={node.name}>
                                {node.name}
                              </span>
                              <span className="preview-node-source truncate">{node.sourceName}</span>
                            </div>
                          ))}
                          {group.nodes.length > 40 && (
                            <div className="preview-node-more">
                              <span>已显示前 40 个，剩余 {group.nodes.length - 40} 个节点已折叠</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        !group.staticProxies.length && (
                          <div className="preview-empty-group-note">
                            <span>当前槽位未配置节点，或被该组的正则过滤规则全部过滤。</span>
                          </div>
                        )
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="preview-empty-state">
            <Layers className="size-8 text-muted-foreground/40 mb-2" />
            <p className="font-medium text-xs text-foreground">
              {search ? '没有匹配的策略组或节点' : '暂无策略组数据'}
            </p>
            <span className="text-[11px] text-muted-foreground mt-0.5">
              {search ? '请尝试搜索其他关键字' : '在左侧选择规则模板并配置节点源，此处将自动呈现'}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
