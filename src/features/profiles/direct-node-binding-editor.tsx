import { useState } from 'react'
import { DragDropProvider } from '@dnd-kit/react'
import { isSortableOperation } from '@dnd-kit/react/sortable'
import type { NodeOption, ProfileSlotBinding, TemplateSourceSlot } from '@/api/types'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { SortableSelectedNode } from './sortable-selected-node'

type DirectNodeBindingEditorProps = {
  slot: TemplateSourceSlot
  value: Extract<ProfileSlotBinding, { mode: 'node' }>
  nodes: NodeOption[]
  onChange: (value: ProfileSlotBinding) => void
}

export function DirectNodeBindingEditor({ slot, value, nodes, onChange }: DirectNodeBindingEditorProps) {
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [mobilePane, setMobilePane] = useState<'available' | 'selected'>('available')
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visible = nodes.filter(
    (node) =>
      (!normalizedQuery || node.name.toLocaleLowerCase().includes(normalizedQuery)) &&
      (sourceFilter === 'all' || node.sourceId === sourceFilter),
  )
  const groups = new Map<string, NodeOption[]>()
  for (const node of visible) groups.set(node.sourceId, [...(groups.get(node.sourceId) || []), node])
  const sourceOptions = [...new Map(nodes.map((node) => [node.sourceId, node.sourceName]))]
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const unavailable = value.nodeIds.filter((id) => {
    const node = nodesById.get(id)
    return !node || !node.enabled || !node.sourceEnabled
  })

  function moveNode(from: number, to: number) {
    if (to < 0 || to >= value.nodeIds.length) return
    const next = [...value.nodeIds]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onChange({ ...value, nodeIds: next })
  }

  return (
    <div className="flex flex-col gap-3">
      <Segmented
        className="direct-node-mobile-tabs"
        block
        value={mobilePane}
        options={[
          { value: 'available', label: '可选节点' },
          { value: 'selected', label: `已选及排序 ${value.nodeIds.length}` },
        ]}
        onChange={setMobilePane}
      />
      <div className="direct-node-editor">
        <section className={cn('direct-node-available', mobilePane !== 'available' && 'direct-node-pane-hidden')}>
          <div className="direct-node-pane-heading">
            <strong>可选节点</strong>
            <Badge variant="secondary">{visible.length} 个</Badge>
          </div>
          <Field>
            <FieldLabel htmlFor={`node-search-${slot.key}`}>搜索</FieldLabel>
            <Input
              id={`node-search-${slot.key}`}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="输入节点名称"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`node-source-${slot.key}`}>节点源</FieldLabel>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger id={`node-source-${slot.key}`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">全部节点源</SelectItem>
                  {sourceOptions.map(([sourceId, sourceName]) => (
                    <SelectItem key={sourceId} value={sourceId}>
                      {sourceName}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <div className="direct-node-options">
            {[...groups].map(([sourceId, items]) => (
              <div key={sourceId} className="direct-node-source-group">
                <p>{items[0].sourceName}</p>
                {items.map((node) => {
                  const checked = value.nodeIds.includes(node.id)
                  const enabled = node.enabled && node.sourceEnabled
                  return (
                    <label
                      key={node.id}
                      htmlFor={`node-${slot.key}-${node.id}`}
                      className={cn('direct-node-option', !enabled && !checked && 'direct-node-option-disabled')}
                    >
                      <Checkbox
                        id={`node-${slot.key}-${node.id}`}
                        checked={checked}
                        disabled={!enabled && !checked}
                        onCheckedChange={() =>
                          onChange({
                            ...value,
                            nodeIds: checked
                              ? value.nodeIds.filter((id) => id !== node.id)
                              : [...value.nodeIds, node.id],
                          })
                        }
                      />
                      <span className="truncate">{node.name}</span>
                    </label>
                  )
                })}
              </div>
            ))}
            {!visible.length && <p className="direct-node-empty">没有匹配的节点</p>}
          </div>
        </section>

        <section className={cn('direct-node-selected', mobilePane !== 'selected' && 'direct-node-pane-hidden')}>
          <div className="direct-node-pane-heading">
            <strong>已选节点 · {value.nodeIds.length}</strong>
            <span>拖动调整输出顺序</span>
          </div>
          <Field data-invalid={!value.nodeIds.length || unavailable.length > 0}>
            <DragDropProvider
              onDragEnd={(event) => {
                if (event.canceled || !isSortableOperation(event.operation) || !event.operation.source) return
                moveNode(event.operation.source.initialIndex, event.operation.source.index)
              }}
            >
              <div className="selected-node-list">
                {value.nodeIds.map((nodeId, index) => (
                  <SortableSelectedNode
                    key={nodeId}
                    nodeId={nodeId}
                    node={nodesById.get(nodeId)}
                    index={index}
                    total={value.nodeIds.length}
                    onRemove={() => onChange({ ...value, nodeIds: value.nodeIds.filter((id) => id !== nodeId) })}
                    onMoveUp={() => moveNode(index, index - 1)}
                    onMoveDown={() => moveNode(index, index + 1)}
                  />
                ))}
                {!value.nodeIds.length && <p className="direct-node-empty">从左侧选择节点，选择顺序即输出顺序</p>}
              </div>
            </DragDropProvider>
            {!value.nodeIds.length && <FieldError>请至少选择一个节点</FieldError>}
          </Field>
        </section>
      </div>
      {unavailable.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>已选节点中有 {unavailable.length} 个不可用节点</span>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => onChange({ ...value, nodeIds: value.nodeIds.filter((id) => !unavailable.includes(id)) })}
            >
              移除不可用节点
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
