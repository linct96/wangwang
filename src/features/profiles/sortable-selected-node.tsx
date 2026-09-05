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
    <div
      ref={ref}
      className={cn(
        'selected-node-row',
        isDragging && 'selected-node-dragging',
        unavailable && 'selected-node-unavailable',
      )}
    >
      <div ref={handleRef} className="selected-node-drag-handle" title="拖动调整顺序" aria-label="拖拽调整节点顺序">
        <GripVertical className="size-3.5" />
      </div>
      <span className="selected-node-index">{index + 1}</span>
      <div className="selected-node-info">
        <div className="selected-node-title-wrap">
          <span className="selected-node-name" title={node?.name || nodeId}>
            {unavailable ? node?.name || '未知或已失效节点' : node.name}
          </span>
          {unavailable && (
            <Badge variant="destructive" className="px-1.5 py-0 text-[10px] h-4">
              不可用
            </Badge>
          )}
        </div>
        <span className="selected-node-source">{node ? node.sourceName : nodeId}</span>
      </div>
      <div className="selected-node-actions">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={index === 0}
          onClick={onMoveUp}
          aria-label="上移一位"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
        >
          <ArrowUp className="size-3" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={index === total - 1}
          onClick={onMoveDown}
          aria-label="下移一位"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
        >
          <ArrowDown className="size-3" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onRemove}
          aria-label="移除该节点"
          className="h-6 w-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
        >
          <X className="size-3" />
        </Button>
      </div>
    </div>
  )
}
