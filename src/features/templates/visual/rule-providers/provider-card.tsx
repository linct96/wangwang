import { useState } from 'react'
import { useSortable } from '@dnd-kit/react/sortable'
import { ChevronDown, CircleAlert, Edit2, Eye, GripVertical, ListPlus, Trash2 } from 'lucide-react'
import { AppDialog, IconButton } from '@/components/app-primitives'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { ruleProviderLabel } from '../model'
import type { ProxyGroupDraft, RuleProviderDraft, VisualIssue } from '../model'
import { ProviderDialog } from './provider-dialog'

function providerSourceLabel(provider: RuleProviderDraft) {
  if (provider.kind === 'raw') return '高级 YAML'
  if (provider.type === 'file') return '本地文件'
  if (provider.type === 'inline') return '内联'

  try {
    let url = new URL(provider.url || '')
    if (url.hostname === 'gh-proxy.com') {
      const innerUrl = decodeURIComponent(url.pathname.slice(1))
      if (!innerUrl) return '自定义'
      url = new URL(innerUrl)
    }
    if (!['github.com', 'raw.githubusercontent.com'].includes(url.hostname)) return '自定义'
    const path = url.pathname.toLowerCase()
    if (path.startsWith('/metacubex/meta-rules-dat/')) return 'MetaCubeX'
    if (path.startsWith('/loyalsoldier/clash-rules/')) return 'Loyalsoldier'
  } catch {
    // URL 合法性由现有表单校验负责。
  }
  return '自定义'
}

export function ProviderCard({
  provider,
  providers,
  groups,
  references,
  issues,
  index,
  onSave,
  onDelete,
  onUse,
}: {
  provider: RuleProviderDraft
  providers: RuleProviderDraft[]
  groups: ProxyGroupDraft[]
  references: number
  issues: VisualIssue[]
  index: number
  onSave: (provider: RuleProviderDraft) => void
  onDelete: () => void
  onUse: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [view, setView] = useState(false)
  const { ref, handleRef, isDragging } = useSortable({
    id: provider.id,
    index,
  })
  const duplicateNameIssue = issues.find((issue) => issue.code === 'PROVIDER_NAME_DUPLICATE')
  const expandedIssues = issues.filter((issue) => issue !== duplicateNameIssue)
  const providerProxy = provider.kind === 'structured' ? provider.proxy : undefined
  const proxy = providerProxy
    ? providerProxy.kind === 'group'
      ? groups.find((group) => group.id === providerProxy.groupId)?.name || '未知代理组'
      : providerProxy.value
    : '未指定'
  return (
    <article
      ref={ref}
      className={cn(
        'template-visual-card',
        isDragging && 'template-card-dragging',
        issues.some((issue) => issue.level === 'error') && 'template-rule-issue',
      )}
    >
      <header className="template-visual-card-header">
        <div
          ref={handleRef}
          className="template-drag-handle"
          title="拖拽排序"
          aria-label="拖拽排序"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="template-drag-icon" />
        </div>
        <div
          className="template-group-header-info text-left"
          role="button"
          tabIndex={0}
          onClick={() => setExpanded((current) => !current)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setExpanded((current) => !current)
            }
          }}
        >
          <ChevronDown className={cn('template-collapse-icon', expanded && 'expanded')} />
          <strong>{provider.name || '未命名数据源'}</strong>
          <Badge variant="secondary">{providerSourceLabel(provider)}</Badge>
          <span className="template-group-summary">
            {ruleProviderLabel(provider)} · {references} 条规则引用
          </span>
        </div>
        <div className="template-visual-card-actions" onClick={(e) => e.stopPropagation()}>
          <IconButton label="添加到分流规则" onClick={onUse}>
            <ListPlus />
          </IconButton>
          {provider.kind === 'structured' ? (
            <ProviderDialog providers={providers} groups={groups} value={provider} onSave={onSave}>
              <IconButton label="编辑规则集数据源">
                <Edit2 />
              </IconButton>
            </ProviderDialog>
          ) : (
            <IconButton label="查看规则集数据源" onClick={() => setView(true)}>
              <Eye />
            </IconButton>
          )}
          <IconButton label="删除规则集数据源" onClick={onDelete}>
            <Trash2 />
          </IconButton>
        </div>
      </header>
      {duplicateNameIssue && (
        <p className="flex items-center gap-1.5 pb-3 pl-7 text-xs text-destructive">
          <CircleAlert className="size-3.5 shrink-0" />
          名称重复，请将其中一个数据源改为唯一名称
        </p>
      )}
      {expanded && (
        <div className="template-group-expanded">
          {provider.kind === 'raw' ? (
            <p className="muted">该数据源使用 YAML Anchor、Merge 或其他高级语法，请切换到 YAML 模式修改。</p>
          ) : (
            <div className="template-group-params">
              {provider.url && (
                <span>
                  URL: <code>{provider.url}</code>
                </span>
              )}
              <span>
                缓存路径: <code>{provider.path || '自动'}</code>
              </span>
              {provider.interval !== undefined && (
                <span>
                  更新间隔: <code>{provider.interval}s</code>
                </span>
              )}
              <span>
                下载代理: <code>{proxy}</code>
              </span>
              {provider.payload && (
                <span>
                  规则内容: <code>{provider.payload.length} 条</code>
                </span>
              )}
            </div>
          )}
          {expandedIssues.length > 0 && (
            <p className="text-xs text-muted-foreground">{expandedIssues.map((issue) => issue.message).join('；')}</p>
          )}
        </div>
      )}
      {view && (
        <AppDialog title={`查看：${provider.name}`} onClose={() => setView(false)}>
          <p className="text-sm text-muted-foreground">该数据源只能在 YAML 模式修改。</p>
          {provider.kind === 'raw' && <pre className="template-raw-preview">{provider.rawYaml}</pre>}
        </AppDialog>
      )}
    </article>
  )
}
