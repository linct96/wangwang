import { useState } from 'react'
import { nanoid } from 'nanoid'
import { DragDropProvider } from '@dnd-kit/react'
import { isSortableOperation, useSortable } from '@dnd-kit/react/sortable'
import { CircleHelp, GripVertical, Network, Plug, Plus, Radio, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
  id,
  index,
  groups,
  sourceSlots,
  onDelete,
}: {
  member: ProxyGroupMemberDraft
  id: string
  index: number
  groups: ProxyGroupDraft[]
  sourceSlots: SourceSlotDraft[]
  onDelete: () => void
}) {
  const { ref, handleRef, isDragging } = useSortable({
    id,
    index,
  })
  const label = memberLabel(member, groups, sourceSlots)

  return (
    <div ref={ref} className={cn('template-member-tag', isDragging && 'template-member-dragging')}>
      <div ref={handleRef} className="template-member-tag-main" title="按住拖拽排序">
        <GripVertical className="template-tag-drag-icon" />
        {member.kind === 'source-slot' && (
          <Plug
            className={cn(
              'template-node-ref-icon shrink-0',
              sourceSlots.find(({ key }) => key === member.slotKey)?.type === 'subscription'
                ? 'text-indigo-500'
                : 'text-amber-500',
            )}
          />
        )}
        {member.kind === 'group' && <Network className="template-node-ref-icon text-blue-500 shrink-0" />}
        {member.kind === 'builtin' && <Radio className="template-node-ref-icon text-emerald-500 shrink-0" />}
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
  children,
}: {
  form: StructuredProxyGroupDraft
  groups: ProxyGroupDraft[]
  sourceSlots: SourceSlotDraft[]
  onChange: (form: StructuredProxyGroupDraft) => void
  children?: React.ReactNode
}) {
  // 对象身份区分重复成员，排序时保留原对象和标识，不写入模板数据。
  const [memberIds] = useState(() => new WeakMap<ProxyGroupMemberDraft, string>())
  const selectedKeys = new Set(
    form.members.map((m) =>
      m.kind === 'source-slot'
        ? `slot:${m.slotKey}`
        : m.kind === 'group'
          ? `group:${m.groupId}`
          : m.kind === 'builtin'
            ? m.value
            : `raw:${m.value}`,
    ),
  )

  const availableBuiltins = (['DIRECT', 'REJECT'] as const).filter((val) => !selectedKeys.has(val))
  const unselectedSlots = sourceSlots.filter((slot) => !selectedKeys.has(`slot:${slot.key}`))
  const unselectedGroups = groups.filter(
    (group) => group.id !== form.id && group.name && !selectedKeys.has(`group:${group.id}`),
  )
  const hasOptions = availableBuiltins.length > 0 || unselectedSlots.length > 0 || unselectedGroups.length > 0

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
      <div className="flex items-center justify-between gap-2">
        <FieldLabel className="items-center gap-1.5">
          <span>代理组节点</span>
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  role="button"
                  tabIndex={0}
                  aria-label="proxies"
                  className="inline-flex items-center text-muted-foreground/70 hover:text-foreground transition-colors cursor-help"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                  }}
                />
              }
            >
              <CircleHelp className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>节点槽位与子组使用 proxies，订阅源槽位自动使用 use</TooltipContent>
          </Tooltip>
        </FieldLabel>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button type="button" variant="outline" size="xs" className="h-6 gap-1 px-2 text-xs">
                <Plus className="size-3" />
                <span>添加</span>
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="max-h-56 overflow-y-auto">
            {availableBuiltins.length > 0 && (
              <DropdownMenuGroup>
                {availableBuiltins.map((val) => (
                  <DropdownMenuItem key={val} onClick={() => addMember(val)}>
                    <Radio className="size-3.5 text-emerald-500 shrink-0" />
                    <span>{val}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            )}
            {unselectedSlots.length > 0 && (
              <>
                {availableBuiltins.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuGroup>
                  {unselectedSlots.map((slot) => (
                    <DropdownMenuItem key={`slot:${slot.key}`} onClick={() => addMember(`slot:${slot.key}`)}>
                      <Plug
                        className={cn(
                          'size-3.5 shrink-0',
                          slot.type === 'subscription' ? 'text-indigo-500' : 'text-amber-500',
                        )}
                      />
                      <span>{slot.name}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </>
            )}
            {unselectedGroups.length > 0 && (
              <>
                {(availableBuiltins.length > 0 || unselectedSlots.length > 0) && <DropdownMenuSeparator />}
                <DropdownMenuGroup>
                  {unselectedGroups.map((group) => (
                    <DropdownMenuItem key={`group:${group.id}`} onClick={() => addMember(`group:${group.id}`)}>
                      <Network className="size-3.5 text-blue-500 shrink-0" />
                      <span>{group.name}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </>
            )}
            {!hasOptions && <div className="px-3 py-2 text-xs text-muted-foreground text-center">暂无更多可用选项</div>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
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
          {form.members.length === 0 ? (
            <div className="col-span-full py-3 text-center text-xs text-muted-foreground">
              暂未包含任何成员，点击右上角“添加”
            </div>
          ) : (
            form.members.map((member, index) => {
              const id = memberIds.get(member) ?? nanoid()
              memberIds.set(member, id)
              return (
                <MemberTag
                  key={id}
                  id={id}
                  member={member}
                  index={index}
                  groups={groups}
                  sourceSlots={sourceSlots}
                  onDelete={() => removeMember(index)}
                />
              )
            })
          )}
        </div>
      </DragDropProvider>
      {children}
    </Field>
  )
}
