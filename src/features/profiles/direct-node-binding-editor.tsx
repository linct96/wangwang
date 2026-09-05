import { useMemo, useState } from 'react'
import { DragDropProvider } from '@dnd-kit/react'
import { isSortableOperation } from '@dnd-kit/react/sortable'
import { AlertCircle, Search, X } from 'lucide-react'
import type { NodeOption, ProfileNodeBinding, TemplateSourceSlot } from '@/api/types'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { SelectionActionButton } from './selection-action-button'
import { SortableSelectedNode } from './sortable-selected-node'

type DirectNodeBindingEditorProps = {
  slot: TemplateSourceSlot
  value: Extract<ProfileNodeBinding, { mode: 'node' }>
  nodes: NodeOption[]
  onChange: (value: ProfileNodeBinding) => void
}

export function DirectNodeBindingEditor({ slot, value, nodes, onChange }: DirectNodeBindingEditorProps) {
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [mobilePane, setMobilePane] = useState<'available' | 'selected'>('available')

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visible = useMemo(
    () =>
      nodes.filter(
        (node) =>
          (!normalizedQuery || node.name.toLocaleLowerCase().includes(normalizedQuery)) &&
          (sourceFilter === 'all' || node.sourceId === sourceFilter),
      ),
    [nodes, normalizedQuery, sourceFilter],
  )

  const groups = useMemo(() => {
    const map = new Map<string, NodeOption[]>()
    for (const node of visible) {
      map.set(node.sourceId, [...(map.get(node.sourceId) || []), node])
    }
    return map
  }, [visible])

  const sourceOptions = useMemo(() => [...new Map(nodes.map((node) => [node.sourceId, node.sourceName]))], [nodes])
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])

  const unavailable = useMemo(
    () =>
      value.nodeIds.filter((id) => {
        const node = nodesById.get(id)
        return !node || !node.enabled || !node.sourceEnabled
      }),
    [value.nodeIds, nodesById],
  )

  function moveNode(from: number, to: number) {
    if (to < 0 || to >= value.nodeIds.length) return
    const next = [...value.nodeIds]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onChange({ ...value, nodeIds: next })
  }

  // 快捷全选当前可见节点
  function selectAllVisible() {
    const availableVisible = visible.filter((n) => n.enabled && n.sourceEnabled).map((n) => n.id)
    const set = new Set([...value.nodeIds, ...availableVisible])
    onChange({ ...value, nodeIds: Array.from(set) })
  }

  // 快捷取消勾选当前可见节点
  function unselectVisible() {
    const visibleIds = new Set(visible.map((n) => n.id))
    onChange({ ...value, nodeIds: value.nodeIds.filter((id) => !visibleIds.has(id)) })
  }

  // 清空所有已选
  function clearAll() {
    onChange({ ...value, nodeIds: [] })
  }

  const selectedVisibleCount = useMemo(
    () => visible.filter((n) => value.nodeIds.includes(n.id)).length,
    [visible, value.nodeIds],
  )

  return (
    <div className="direct-node-container">
      {unavailable.length > 0 && (
        <Alert variant="destructive" className="py-2.5">
          <AlertCircle className="size-4" />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2 w-full">
            <span>
              已选列表中有 <strong>{unavailable.length}</strong> 个节点当前已停用或失效，无法用于生成配置。
            </span>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() =>
                onChange({
                  ...value,
                  nodeIds: value.nodeIds.filter((id) => !unavailable.includes(id)),
                })
              }
              className="bg-destructive/10 hover:bg-destructive/20 border-destructive/30"
            >
              一键清除失效节点
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Segmented
        className="direct-node-mobile-tabs"
        block
        value={mobilePane}
        options={[
          { value: 'available', label: `可选节点 (${visible.length})` },
          { value: 'selected', label: `已选及排序 (${value.nodeIds.length})` },
        ]}
        onChange={setMobilePane}
      />

      <div className="direct-node-workbench">
        {/* 左栏：节点库 */}
        <section
          className={cn(
            'direct-node-pane direct-node-available',
            mobilePane !== 'available' && 'direct-node-pane-hidden',
          )}
        >
          <div className="direct-node-pane-header">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">节点库</span>
            </div>
            <div className="flex items-center gap-1.5">
              <SelectionActionButton
                count={selectedVisibleCount}
                disabled={!visible.some((n) => n.enabled && n.sourceEnabled)}
                onSelectAll={selectAllVisible}
                onClear={unselectVisible}
              />
            </div>
          </div>

          <div className="direct-node-filters">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
              <Input
                id={`node-search-${slot.key}`}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索节点名称..."
                className="pl-8 h-8 text-xs"
              />
            </div>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger id={`node-source-${slot.key}`} className="w-[140px] h-8 text-xs shrink-0">
                <SelectValue placeholder="筛选节点源" />
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
          </div>

          <div className="direct-node-scroll-area">
            {[...groups].map(([sourceId, items]) => (
              <div key={sourceId} className="direct-node-source-section">
                <div className="direct-node-source-title">
                  <span>{items[0].sourceName}</span>
                  <Badge variant="outline" className="text-[10px] h-4 px-1">
                    {items.length}
                  </Badge>
                </div>
                <div className="direct-node-items-list">
                  {items.map((node) => {
                    const checked = value.nodeIds.includes(node.id)
                    const enabled = node.enabled && node.sourceEnabled
                    return (
                      <label
                        key={node.id}
                        htmlFor={`node-${slot.key}-${node.id}`}
                        className={cn(
                          'direct-node-item',
                          checked && 'direct-node-item-checked',
                          !enabled && 'direct-node-item-disabled',
                        )}
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
                          className="size-4"
                        />
                        <span className="truncate text-xs flex-1" title={node.name}>
                          {node.name}
                        </span>
                        {!enabled && (
                          <Badge variant="outline" className="text-[10px] h-4 px-1 text-muted-foreground">
                            已停用
                          </Badge>
                        )}
                      </label>
                    )
                  })}
                </div>
              </div>
            ))}
            {!visible.length && (
              <div className="direct-node-empty">
                <p>未找到匹配的节点</p>
                {query && (
                  <Button
                    type="button"
                    variant="link"
                    size="xs"
                    onClick={() => setQuery('')}
                    className="text-xs text-primary"
                  >
                    清除搜索词
                  </Button>
                )}
              </div>
            )}
          </div>
        </section>

        {/* 右栏：已选节点及拖拽排序 */}
        <section
          className={cn(
            'direct-node-pane direct-node-selected',
            mobilePane !== 'selected' && 'direct-node-pane-hidden',
          )}
        >
          <div className="direct-node-pane-header">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">输出排序</span>
              <Badge variant="secondary" className="text-xs font-normal text-muted-foreground">
                已选 {value.nodeIds.length}
              </Badge>
            </div>
            {value.nodeIds.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={clearAll}
                className="h-7 px-2.5 gap-1.5 text-xs text-muted-foreground hover:text-destructive border-border/70 hover:border-destructive/30 hover:bg-destructive/10 rounded-md font-medium shadow-none transition-all"
              >
                <X className="size-3.5" />
                清空
              </Button>
            )}
          </div>

          <div className="flex-1 min-h-0 flex flex-col gap-0">
            <div className="direct-node-sort-hint">
              <span>上下拖拽手柄或点击箭头调整节点在订阅中的先后顺序</span>
            </div>

            <div className="direct-node-scroll-area flex-1">
              <DragDropProvider
                onDragEnd={(event) => {
                  if (event.canceled || !isSortableOperation(event.operation) || !event.operation.source) return
                  moveNode(event.operation.source.initialIndex, event.operation.source.index)
                }}
              >
                <div className="selected-nodes-stack">
                  {value.nodeIds.map((nodeId, index) => (
                    <SortableSelectedNode
                      key={nodeId}
                      nodeId={nodeId}
                      node={nodesById.get(nodeId)}
                      index={index}
                      onRemove={() => onChange({ ...value, nodeIds: value.nodeIds.filter((id) => id !== nodeId) })}
                    />
                  ))}
                  {!value.nodeIds.length && (
                    <div className="rounded-md border border-dashed px-4 py-8 text-center">
                      <p className="text-sm font-medium text-foreground">尚未选择任何节点</p>
                      <p className="mt-1 text-xs text-muted-foreground">在左侧勾选需要包含的节点，勾选顺序即输出顺序</p>
                    </div>
                  )}
                </div>
              </DragDropProvider>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
