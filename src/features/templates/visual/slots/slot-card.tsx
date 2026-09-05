import { useState } from 'react'
import { useSortable } from '@dnd-kit/react/sortable'
import { ChevronDown, CircleAlert, Edit2, GripVertical, Network, Plug, Trash2 } from 'lucide-react'
import { IconButton } from '@/components/app-primitives'
import { cn } from '@/lib/utils'
import type { ProxyGroupDraft, SourceSlotDraft, VisualIssue } from '../model'
import { SlotDialog } from './slot-dialog'

export function SlotCard({
  slot,
  slots,
  groups,
  index,
  issues,
  onSave,
  onDelete,
}: {
  slot: SourceSlotDraft
  slots: SourceSlotDraft[]
  groups: ProxyGroupDraft[]
  index: number
  issues: VisualIssue[]
  onSave: (slot: SourceSlotDraft) => void
  onDelete: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const { ref, handleRef, isDragging } = useSortable({
    id: slot.key,
    index,
  })

  const referencingGroups = groups.filter(
    (group) =>
      group.kind === 'structured' &&
      group.members.some((member) => member.kind === 'source-slot' && member.slotKey === slot.key),
  )

  const slotIssues = issues.filter((issue) => issue.slotKey === slot.key)
  const hasError = slotIssues.some((issue) => issue.level === 'error')

  return (
    <article
      ref={ref}
      className={cn('template-visual-card', isDragging && 'template-card-dragging', hasError && 'template-rule-issue')}
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
          onClick={() => setExpanded((prev) => !prev)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setExpanded((prev) => !prev)
            }
          }}
        >
          <ChevronDown className={cn('template-collapse-icon', expanded && 'expanded')} />
          <div className="flex items-center gap-2 min-w-0">
            <Plug className="size-4 text-amber-500 shrink-0" />
            <strong className="truncate">{slot.name || '未命名槽位'}</strong>
          </div>
          {slotIssues.length > 0 && (
            <span className="flex items-center gap-1 text-xs text-destructive">
              <CircleAlert className="size-3.5 shrink-0" />
              <span className="truncate max-w-[200px] sm:max-w-[320px]">{slotIssues[0].message}</span>
            </span>
          )}
          {!expanded && (
            <span className="template-group-summary">
              {referencingGroups.length > 0 ? `${referencingGroups.length} 个代理组引用` : '未被代理组引用'}
            </span>
          )}
        </div>
        <div className="template-visual-card-actions" onClick={(e) => e.stopPropagation()}>
          <SlotDialog slots={slots} groups={groups} value={slot} onSave={onSave}>
            <IconButton label="编辑槽位">
              <Edit2 />
            </IconButton>
          </SlotDialog>
          <IconButton
            label="删除槽位"
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
          <div className="template-group-nodes-section">
            <div className="template-node-ref-title">引用该槽位的代理组</div>
            {referencingGroups.length === 0 ? (
              <div className="template-node-ref-empty">暂未被任何代理组引用</div>
            ) : (
              <div className="template-node-ref-tags">
                {referencingGroups.map((group) => (
                  <div key={group.id} className="template-node-tag">
                    <Network className="template-node-ref-icon text-blue-500" />
                    <span className="template-node-tag-name">{group.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </article>
  )
}
