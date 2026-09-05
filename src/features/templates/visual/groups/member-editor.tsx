import { DragDropProvider } from '@dnd-kit/react'
import { isSortableOperation, useSortable } from '@dnd-kit/react/sortable'
import { CircleHelp, GripVertical, Plus, X } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Field, FieldLabel } from '@/components/ui/field'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  memberLabel,
  type ProxyGroupDraft,
  type ProxyGroupMemberDraft,
  type SourceSlotDraft,
  type StructuredProxyGroupDraft,
} from '../model'

export function MemberTag({
  member,
  index,
  groups,
  sourceSlots,
  onDelete,
}: {
  member: ProxyGroupMemberDraft
  index: number
  groups: ProxyGroupDraft[]
  sourceSlots: SourceSlotDraft[]
  onDelete: () => void
}) {
  const { ref, handleRef, isDragging } = useSortable({
    id: `member-${index}`,
    index,
  })
  const label = memberLabel(member, groups, sourceSlots)

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
  sourceSlots,
  onChange,
}: {
  form: StructuredProxyGroupDraft
  groups: ProxyGroupDraft[]
  sourceSlots: SourceSlotDraft[]
  onChange: (form: StructuredProxyGroupDraft) => void
}) {
  const choices = [
    ...sourceSlots.map(({ key, name }) => ({ value: `slot:${key}`, label: name })),
    { value: 'DIRECT', label: 'DIRECT' },
    { value: 'REJECT', label: 'REJECT' },
    ...groups
      .filter((group) => group.id !== form.id && group.name)
      .map((group) => ({ value: `group:${group.id}`, label: group.name })),
  ]

  function addMember(val: string) {
    const member: ProxyGroupMemberDraft = val.startsWith('slot:')
      ? { kind: 'source-slot', slotKey: val.slice(5) }
      : val === 'DIRECT' || val === 'REJECT'
        ? { kind: 'builtin', value: val }
        : { kind: 'group', groupId: val.slice(6) }
    onChange({ ...form, members: [...form.members, member] })
  }

  function removeMember(index: number) {
    const removed = form.members[index]
    const removedName = removed && memberLabel(removed, groups, sourceSlots)
    onChange({
      ...form,
      members: form.members.filter((_, idx) => idx !== index),
      ...(form.defaultSelected === removedName ? { defaultSelected: undefined } : {}),
    })
  }

  return (
    <Field>
      <FieldLabel className="items-center gap-1.5">
        <span>包含节点与子组</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              role="button"
              tabIndex={-1}
              className="inline-flex items-center text-muted-foreground/70 hover:text-foreground transition-colors cursor-help"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
              }}
            >
              <CircleHelp className="size-3.5" />
            </span>
          </TooltipTrigger>
          <TooltipContent className="font-mono text-xs">proxies</TooltipContent>
        </Tooltip>
      </FieldLabel>
      <DragDropProvider
        onDragEnd={(event) => {
          if (event.canceled || !isSortableOperation(event.operation) || !event.operation.source) return
          const { source } = event.operation
          const from = source.initialIndex
          const to = source.index
          if (from === to || from < 0 || from >= form.members.length || to < 0 || to >= form.members.length) return
          const nextMembers = [...form.members]
          const [moved] = nextMembers.splice(from, 1)
          nextMembers.splice(to, 0, moved)
          onChange({ ...form, members: nextMembers })
        }}
      >
        <div className="template-member-tags-container">
          {form.members.map((member, index) => (
            <MemberTag
              key={`${member.kind}-${member.kind === 'group' ? member.groupId : member.kind === 'source-slot' ? member.slotKey : member.value}-${index}`}
              member={member}
              index={index}
              groups={groups}
              sourceSlots={sourceSlots}
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
