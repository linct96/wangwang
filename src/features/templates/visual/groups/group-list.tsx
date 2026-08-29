import { DragDropProvider } from '@dnd-kit/react'
import type { ProxyGroupDraft } from '../model'
import { GroupCard } from './group-card'

export function GroupList({
  groups,
  onChange,
  onDelete,
}: {
  groups: ProxyGroupDraft[]
  onChange: (groups: ProxyGroupDraft[]) => void
  onDelete: (group: ProxyGroupDraft) => void
}) {
  return (
    <DragDropProvider
      onDragEnd={(event) => {
        const { source, target } = event.operation
        if (!source || !target || source.id === target.id) return
        const from = groups.findIndex((group) => group.id === source.id)
        const to = groups.findIndex((group) => group.id === target.id)
        if (from < 0 || to < 0) return
        const next = [...groups]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        onChange(next)
      }}
    >
      <div className="template-visual-list">
        {groups.map((group, index) => (
          <GroupCard
            key={group.id}
            index={index}
            group={group}
            groups={groups}
            onSave={(next) => onChange(groups.map((item) => (item.id === group.id ? next : item)))}
            onDelete={() => onDelete(group)}
          />
        ))}
      </div>
    </DragDropProvider>
  )
}
