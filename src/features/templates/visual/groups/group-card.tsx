import { useState } from 'react'
import { useSortable } from '@dnd-kit/react/sortable'
import { ChevronDown, Edit2, Eye, GripVertical, Network, Radio, Server, Trash2, Zap } from 'lucide-react'
import { AppDialog, IconButton } from '@/components/app-primitives'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { memberLabel, type ProxyGroupDraft, type SourceSlotDraft } from '../model'
import { GroupDialog } from './group-dialog'

export function GroupCard({
  group,
  groups,
  sourceSlots = [],
  index,
  onSave,
  onDelete,
}: {
  group: ProxyGroupDraft
  groups: ProxyGroupDraft[]
  sourceSlots?: SourceSlotDraft[]
  index: number
  onSave: (group: ProxyGroupDraft) => void
  onDelete: () => void
}) {
  const [view, setView] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const { ref, handleRef, isDragging } = useSortable({
    id: group.id,
    index,
  })

  return (
    <article ref={ref} className={cn('template-visual-card', isDragging && 'template-card-dragging')}>
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
          className="template-group-header-info"
          role="button"
          tabIndex={0}
          onClick={() => setExpanded((prev) => !prev)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setExpanded((prev) => !prev)
            }
          }}
        >
          <ChevronDown className={cn('template-collapse-icon', expanded && 'expanded')} />
          <strong>{group.name || '未命名代理组'}</strong>
          <Badge variant="secondary">{group.type}</Badge>
          {!expanded && (
            <span className="template-group-summary">
              {group.kind === 'structured' ? `${group.members.length} 个节点/子组` : 'RAW 配置'}
            </span>
          )}
        </div>
        <div className="template-visual-card-actions" onClick={(e) => e.stopPropagation()}>
          {group.kind === 'raw' ? (
            <IconButton
              label="查看详情"
              onClick={(e) => {
                e.stopPropagation()
                setView(true)
              }}
            >
              <Eye />
            </IconButton>
          ) : (
            <GroupDialog groups={groups} sourceSlots={sourceSlots} value={group} onSave={onSave}>
              <IconButton label="编辑代理组">
                <Edit2 />
              </IconButton>
            </GroupDialog>
          )}
          <IconButton
            label="删除代理组"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
          >
            <Trash2 />
          </IconButton>
        </div>
      </header>

      {expanded && (
        <div className="template-group-expanded">
          {group.kind === 'raw' ? (
            <div className="template-group-raw-info">
              <p className="muted">当前版本不支持可视化修改，请使用 YAML 编辑。</p>
              {Array.isArray(group.raw?.proxies) && group.raw.proxies.length > 0 && (
                <div className="template-node-ref-section">
                  <div className="template-node-ref-title">引用的节点 ({group.raw.proxies.length})</div>
                  <div className="template-node-ref-tags">
                    {group.raw.proxies.map((name: unknown, index: number) => (
                      <div key={index} className="template-node-tag">
                        <Server className="template-node-ref-icon text-muted-foreground" />
                        <span className="template-node-tag-name">{String(name)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="template-group-detail">
              {(group.filter ||
                group.excludeFilter ||
                group.url ||
                group.interval !== undefined ||
                group.tolerance !== undefined ||
                group.strategy) && (
                <div className="template-group-params">
                  {group.filter && (
                    <span className="template-group-param-item">
                      包含: <code>{group.filter}</code>
                    </span>
                  )}
                  {group.excludeFilter && (
                    <span className="template-group-param-item">
                      排除: <code>{group.excludeFilter}</code>
                    </span>
                  )}
                  {group.url && (
                    <span className="template-group-param-item" title={group.url}>
                      测速: <code>{group.url}</code>
                    </span>
                  )}
                  {group.interval !== undefined && (
                    <span className="template-group-param-item">
                      检测间隔: <code>{group.interval}s</code>
                    </span>
                  )}
                  {group.tolerance !== undefined && (
                    <span className="template-group-param-item">
                      容差: <code>{group.tolerance}ms</code>
                    </span>
                  )}
                  {group.strategy && (
                    <span className="template-group-param-item">
                      策略: <code>{group.strategy}</code>
                    </span>
                  )}
                </div>
              )}
              <div className="template-node-ref-title">包含节点与子组</div>
              {group.members.length === 0 ? (
                <div className="template-node-ref-empty">暂无包含节点与子组</div>
              ) : (
                <div className="template-node-ref-tags">
                  {group.members.map((member, index) => {
                    const label = memberLabel(member, groups, sourceSlots)
                    return (
                      <div key={`${member.kind}-${index}`} className="template-node-tag">
                        {member.kind === 'source-slot' && <Zap className="template-node-ref-icon text-amber-500" />}
                        {member.kind === 'group' && <Network className="template-node-ref-icon text-blue-500" />}
                        {member.kind === 'builtin' && <Radio className="template-node-ref-icon text-emerald-500" />}
                        {member.kind === 'raw' && <Server className="template-node-ref-icon text-purple-500" />}
                        <span className="template-node-tag-name">{label}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {view && group.kind === 'raw' && (
        <AppDialog title={`查看：${group.name}`} contentClassName="template-dialog" onClose={() => setView(false)}>
          <pre className="template-raw-preview">{JSON.stringify(group.raw, null, 2)}</pre>
        </AppDialog>
      )}
    </article>
  )
}
