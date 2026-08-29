import { DragDropProvider } from '@dnd-kit/react'
import { useSortable } from '@dnd-kit/react/sortable'
import { GripVertical, Plus, X } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Field, FieldLabel } from '@/components/ui/field'
import { cn } from '@/lib/utils'
import { memberLabel, type ProxyGroupDraft, type ProxyGroupMemberDraft, type StructuredProxyGroupDraft } from '../model'

export function MemberTag({
  member,
  index,
  groups,
  onDelete,
}: {
  member: ProxyGroupMemberDraft
  index: number
  groups: ProxyGroupDraft[]
  onDelete: () => void
}) {
  const { ref, handleRef, isDragging } = useSortable({
    id: `member-${index}`,
    index,
  })
  const label = memberLabel(member, groups)

  return (
    <div ref={ref} className={cn('template-member-tag', isDragging && 'template-member-dragging')}>
      <div ref={handleRef} className="template-member-tag-main" title="按住拖拽排序">
        <GripVertical className="template-tag-drag-icon" />
        <span className="template-member-tag-name" title={label}>
          {label}
        </span>
      </div>
      <button
        type="button"
        className="template-tag-remove"
        title="移除"
        aria-label="移除"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
      >
        <X />
      </button>
    </div>
  )
}

export function MemberEditor({
  form,
  groups,
  onChange,
}: {
  form: StructuredProxyGroupDraft
  groups: ProxyGroupDraft[]
  onChange: (form: StructuredProxyGroupDraft) => void
}) {
  const choices = [
    { value: 'all', label: '自定义节点源' },
    { value: 'DIRECT', label: 'DIRECT' },
    { value: 'REJECT', label: 'REJECT' },
    ...groups
      .filter((group) => group.id !== form.id && group.name)
      .map((group) => ({ value: `group:${group.id}`, label: group.name })),
  ]

  function addMember(val: string) {
    const member: ProxyGroupMemberDraft =
      val === 'all'
        ? { kind: 'all-proxies' }
        : val === 'DIRECT' || val === 'REJECT'
          ? { kind: 'builtin', value: val }
          : { kind: 'group', groupId: val.slice(6) }
    onChange({ ...form, members: [...form.members, member] })
  }

  function removeMember(index: number) {
    const removed = form.members[index]
    const removedName = removed && memberLabel(removed, groups)
    onChange({
      ...form,
      members: form.members.filter((_, idx) => idx !== index),
      ...(form.defaultSelected === removedName ? { defaultSelected: undefined } : {}),
    })
  }

  return (
    <Field>
      <FieldLabel>包含节点与子组 (proxies)</FieldLabel>
      <DragDropProvider
        onDragEnd={(event) => {
          const { source, target } = event.operation
          if (!source || !target || source.id === target.id) return
          const sourceStr = String(source.id)
          const targetStr = String(target.id)
          if (sourceStr.startsWith('member-') && targetStr.startsWith('member-')) {
            const fromIndex = Number(sourceStr.slice(7))
            const toIndex = Number(targetStr.slice(7))
            if (
              !Number.isNaN(fromIndex) &&
              !Number.isNaN(toIndex) &&
              fromIndex >= 0 &&
              fromIndex < form.members.length &&
              toIndex >= 0 &&
              toIndex < form.members.length
            ) {
              const nextMembers = [...form.members]
              const [moved] = nextMembers.splice(fromIndex, 1)
              nextMembers.splice(toIndex, 0, moved)
              onChange({ ...form, members: nextMembers })
            }
          }
        }}
      >
        <div className="template-member-tags-container">
          {form.members.map((member, index) => (
            <MemberTag
              key={`${member.kind}-${member.kind === 'group' ? member.groupId : member.kind === 'builtin' || member.kind === 'raw' ? member.value : 'all'}-${index}`}
              member={member}
              index={index}
              groups={groups}
              onDelete={() => removeMember(index)}
            />
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="template-member-add-trigger" onPointerDown={(e) => e.stopPropagation()}>
                <Plus className="template-add-tag-icon" />
                <span>添加节点/组</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-56 overflow-y-auto">
              {choices.map((choice) => {
                return (
                  <DropdownMenuItem key={choice.value} onClick={() => addMember(choice.value)}>
                    <span>{choice.label}</span>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </DragDropProvider>
    </Field>
  )
}
