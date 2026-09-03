import { DragDropProvider } from '@dnd-kit/react'
import { isSortableOperation } from '@dnd-kit/react/sortable'
import type { ProxyGroupDraft, SourceSlotDraft, VisualChangeMeta } from '../model'
import { GroupCard } from './group-card'

export function GroupList({
  groups,
  sourceSlots = [],
  onChange,
  onDelete,
}: {
  groups: ProxyGroupDraft[]
  sourceSlots?: SourceSlotDraft[]
  onChange: (groups: ProxyGroupDraft[], meta?: VisualChangeMeta) => void
  onDelete: (group: ProxyGroupDraft) => void
}) {
  return (
    <DragDropProvider
      onDragEnd={(event) => {
        if (event.canceled || !isSortableOperation(event.operation) || !event.operation.source) return
        const { source } = event.operation
        const from = source.initialIndex
        const to = source.index
        if (from === to || from < 0 || from >= groups.length || to < 0 || to >= groups.length) return
        const next = [...groups]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        onChange(next, { type: 'reorder', scope: 'groups' })
      }}
    >
      <div className="template-visual-list">
        {groups.map((group, index) => (
          <GroupCard
            key={group.id}
            index={index}
            group={group}
            groups={groups}
            sourceSlots={sourceSlots}
            onSave={(next) => onChange(groups.map((item) => (item.id === group.id ? next : item)))}
            onDelete={() => onDelete(group)}
          />
        ))}
      </div>
    </DragDropProvider>
  )
}
