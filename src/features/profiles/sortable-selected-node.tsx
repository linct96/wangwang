import { useSortable } from '@dnd-kit/react/sortable'
import { ArrowDown, ArrowUp, GripVertical, X } from 'lucide-react'
import type { NodeOption } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type SortableSelectedNodeProps = {
  node: NodeOption | undefined
  nodeId: string
  index: number
  total: number
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}

export function SortableSelectedNode({
  node,
  nodeId,
  index,
  total,
  onRemove,
  onMoveUp,
  onMoveDown,
}: SortableSelectedNodeProps) {
  const { ref, handleRef, isDragging } = useSortable({ id: nodeId, index })
  const unavailable = !node || !node.enabled || !node.sourceEnabled

  return (
    <div ref={ref} className={cn('selected-node-row', isDragging && 'selected-node-dragging')}>
      <div ref={handleRef} className="selected-node-drag-handle" title="拖拽排序" aria-label="拖拽排序">
        <GripVertical />
      </div>
      <span className="selected-node-index">{index + 1}</span>
      <div className="selected-node-info">
        <strong>{unavailable ? '节点不可用' : node.name}</strong>
        <span>{node ? node.sourceName : nodeId}</span>
      </div>
      {unavailable && <Badge variant="destructive">不可用</Badge>}
      <div className="selected-node-actions">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={index === 0}
          onClick={onMoveUp}
          aria-label="上移"
        >
          <ArrowUp />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={index === total - 1}
          onClick={onMoveDown}
          aria-label="下移"
        >
          <ArrowDown />
        </Button>
        <Button type="button" variant="ghost" size="icon-xs" onClick={onRemove} aria-label="移除节点">
          <X />
        </Button>
      </div>
    </div>
  )
}
