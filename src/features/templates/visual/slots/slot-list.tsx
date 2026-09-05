import { DragDropProvider } from '@dnd-kit/react'
import { isSortableOperation } from '@dnd-kit/react/sortable'
import type { ProxyGroupDraft, SourceSlotDraft, VisualChangeMeta, VisualIssue } from '../model'
import { SlotCard } from './slot-card'

export function SlotList({
  slots,
  groups,
  issues,
  onChange,
  onSave,
  onDelete,
}: {
  slots: SourceSlotDraft[]
  groups: ProxyGroupDraft[]
  issues: VisualIssue[]
  onChange: (slots: SourceSlotDraft[], meta?: VisualChangeMeta) => void
  onSave: (slot: SourceSlotDraft) => void
  onDelete: (slot: SourceSlotDraft) => void
}) {
  if (slots.length === 0) {
    return (
      <div className="rounded-md border border-dashed px-4 py-8 text-center">
        <p className="text-sm font-medium">暂无节点源槽位</p>
        <p className="mt-1 text-sm text-muted-foreground">点击上方“添加槽位”定义模板需要的节点源槽位。</p>
      </div>
    )
  }

  return (
    <DragDropProvider
      onDragEnd={(event) => {
        if (event.canceled || !isSortableOperation(event.operation) || !event.operation.source) return
        const { source } = event.operation
        const from = source.initialIndex
        const to = source.index
        if (from === to || from < 0 || from >= slots.length || to < 0 || to >= slots.length) return
        const next = [...slots]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        onChange(next, { type: 'reorder', scope: 'sourceSlots' })
      }}
    >
      <div className="template-visual-list">
        {slots.map((slot, index) => (
          <SlotCard
            key={slot.key}
            index={index}
            slot={slot}
            slots={slots}
            groups={groups}
            issues={issues}
            onSave={onSave}
            onDelete={() => onDelete(slot)}
          />
        ))}
      </div>
    </DragDropProvider>
  )
}
