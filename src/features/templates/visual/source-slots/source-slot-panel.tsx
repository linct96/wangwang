import { DragDropProvider } from '@dnd-kit/react'
import { isSortableOperation, useSortable } from '@dnd-kit/react/sortable'
import { Edit2, GripVertical, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { IconButton } from '@/components/app-primitives'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ProxyGroupDraft, SourceSlotDraft, VisualChangeMeta } from '../model'
import { SourceSlotDialog } from './source-slot-dialog'
import { generateSourceSlotKey } from '../../../../../worker/templates/source-slots'

function SlotCard({
  slot,
  slots,
  index,
  locked,
  onRename,
  onDelete,
}: {
  slot: SourceSlotDraft
  slots: SourceSlotDraft[]
  index: number
  locked: boolean
  onRename: (name: string) => void
  onDelete: () => void
}) {
  const { ref, handleRef, isDragging } = useSortable({
    id: slot.key,
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
        <div className="template-group-header-info">
          <strong>{slot.name || '未命名槽位'}</strong>
          <code className="text-xs text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">{slot.key}</code>
        </div>
        <div className="template-visual-card-actions" onClick={(e) => e.stopPropagation()}>
          <SourceSlotDialog value={slot} existingSlots={slots} onSave={onRename}>
            <IconButton label="重命名槽位">
              <Edit2 />
            </IconButton>
          </SourceSlotDialog>
          <IconButton
            label={locked ? '模板正在被配置使用，不能删除槽位' : '删除槽位'}
            disabled={locked}
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
          >
            <Trash2 />
          </IconButton>
        </div>
      </header>
    </article>
  )
}

export function SourceSlotPanel({
  slots,
  groups,
  locked = false,
  onChange,
}: {
  slots: SourceSlotDraft[]
  groups: ProxyGroupDraft[]
  locked?: boolean
  onChange: (slots: SourceSlotDraft[], meta?: VisualChangeMeta) => void
}) {
  function handleAdd(name: string) {
    if (locked) {
      toast.error('模板正在被配置使用，不能新增节点源槽位')
      return
    }
    if (slots.length >= 20) {
      toast.error('节点源槽位数量不能超过 20 个')
      return
    }
    try {
      const key = generateSourceSlotKey(slots.map((s) => s.key))
      onChange([...slots, { key, name }])
      toast.success(`已添加槽位“${name}”`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '生成槽位失败')
    }
  }

  function handleRename(key: string, newName: string) {
    onChange(slots.map((s) => (s.key === key ? { ...s, name: newName } : s)))
  }

  function handleDelete(slot: SourceSlotDraft) {
    if (locked) {
      toast.error('模板正在被配置使用，不能删除节点源槽位')
      return
    }
    if (slots.length <= 1) {
      toast.error('模板必须保留至少一个节点源槽位')
      return
    }
    const referencingGroups = groups.filter(
      (g) => g.kind === 'structured' && g.members.some((m) => m.kind === 'source-slot' && m.slotKey === slot.key),
    )
    if (referencingGroups.length > 0) {
      const names = referencingGroups.map((g) => `“${g.name}”`).join('、')
      toast.error(`无法删除槽位“${slot.name}”：已被代理组 ${names} 引用，请先在代理组中移除该槽位`)
      return
    }
    onChange(slots.filter((s) => s.key !== slot.key))
    toast.success(`已删除槽位“${slot.name}”`)
  }

  return (
    <section className="template-visual-section">
      <header className="template-visual-toolbar">
        <div className="template-rule-header-left">
          <h2>节点源槽位</h2>
          <span className="template-section-count">{slots.length}</span>
        </div>
        <div className="template-rule-header-right">
          <SourceSlotDialog existingSlots={slots} onSave={handleAdd}>
            <Button
              type="button"
              size="default"
              disabled={locked}
              title={locked ? '模板正在被配置使用，不能新增槽位' : undefined}
            >
              <Plus data-icon="inline-start" />
              添加槽位
            </Button>
          </SourceSlotDialog>
        </div>
      </header>
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
              slot={slot}
              slots={slots}
              index={index}
              locked={locked}
              onRename={(newName) => handleRename(slot.key, newName)}
              onDelete={() => handleDelete(slot)}
            />
          ))}
        </div>
      </DragDropProvider>
    </section>
  )
}
