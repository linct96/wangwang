import { useState } from 'react'
import type { NodeOption, ProfileSlotBinding, Source, TemplateSourceSlot } from '@/api/types'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

function regexError(value: string | null) {
  if (!value) return false
  try {
    new RegExp(value)
    return false
  } catch {
    return true
  }
}

export function SlotBindingEditor({
  slot,
  value,
  sources,
  nodes,
  onChange,
}: {
  slot: TemplateSourceSlot
  value: ProfileSlotBinding
  sources: Source[]
  nodes: NodeOption[]
  onChange: (value: ProfileSlotBinding) => void
}) {
  const [query, setQuery] = useState('')
  const includeInvalid = value.mode === 'source' && regexError(value.includeRegex)
  const excludeInvalid = value.mode === 'source' && regexError(value.excludeRegex)

  function setMode(mode: 'source' | 'node') {
    if (mode === value.mode) return
    onChange(
      mode === 'source'
        ? { slotKey: slot.key, mode, sourceIds: [], includeRegex: null, excludeRegex: null }
        : { slotKey: slot.key, mode, nodeIds: [], missingNodeIds: [] },
    )
  }

  return (
    <Field className="gap-4 rounded-lg border p-4" data-invalid={includeInvalid || excludeInvalid}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FieldLabel>{slot.name}</FieldLabel>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={value.mode}
          onValueChange={(mode) => mode && setMode(mode as 'source' | 'node')}
          aria-label={`${slot.name}绑定模式`}
        >
          <ToggleGroupItem value="source">按节点源</ToggleGroupItem>
          <ToggleGroupItem value="node">指定节点</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {value.mode === 'source' ? (
        <div className="flex flex-col gap-4">
          <Field data-invalid={!value.sourceIds.length}>
            <div className="flex items-center justify-between gap-2">
              <FieldLabel>节点源</FieldLabel>
              <Badge variant="secondary">已选 {value.sourceIds.length}</Badge>
            </div>
            <div className="grid max-h-44 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
              {sources.map((source) => {
                const checked = value.sourceIds.includes(source.id)
                return (
                  <label
                    key={source.id}
                    htmlFor={`source-${slot.key}-${source.id}`}
                    className={cn(
                      'flex items-center justify-between gap-2 rounded-lg border p-2 text-sm',
                      source.enabled || checked ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
                      checked && 'border-primary/40 bg-primary/5',
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Checkbox
                        id={`source-${slot.key}-${source.id}`}
                        checked={checked}
                        disabled={!source.enabled && !checked}
                        onCheckedChange={() =>
                          onChange({
                            ...value,
                            sourceIds: checked
                              ? value.sourceIds.filter((id) => id !== source.id)
                              : [...value.sourceIds, source.id],
                          })
                        }
                        aria-invalid={!value.sourceIds.length}
                      />
                      <span className="truncate">{source.name}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      {source.nodeNameFilter && <Badge variant="outline">已过滤</Badge>}
                      <Badge variant="outline">{source.nodeCount}</Badge>
                    </span>
                  </label>
                )
              })}
            </div>
            {!sources.length && <FieldDescription>暂无节点源</FieldDescription>}
            {!value.sourceIds.length && <FieldError>请至少选择一个节点源</FieldError>}
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field data-invalid={includeInvalid}>
              <FieldLabel htmlFor={`include-${slot.key}`}>包含正则</FieldLabel>
              <Input
                id={`include-${slot.key}`}
                value={value.includeRegex || ''}
                maxLength={200}
                placeholder="例如：香港|HK"
                aria-invalid={includeInvalid}
                onChange={(event) => onChange({ ...value, includeRegex: event.target.value || null })}
              />
              {includeInvalid && <FieldError>包含正则格式无效</FieldError>}
            </Field>
            <Field data-invalid={excludeInvalid}>
              <FieldLabel htmlFor={`exclude-${slot.key}`}>排除正则</FieldLabel>
              <Input
                id={`exclude-${slot.key}`}
                value={value.excludeRegex || ''}
                maxLength={200}
                placeholder="例如：测试|倍率"
                aria-invalid={excludeInvalid}
                onChange={(event) => onChange({ ...value, excludeRegex: event.target.value || null })}
              />
              {excludeInvalid && <FieldError>排除正则格式无效</FieldError>}
            </Field>
          </div>
          <FieldDescription>槽位过滤仅作用于此配置；节点源自身过滤仍在节点源页面管理。</FieldDescription>
        </div>
      ) : (
        <NodeSelector slot={slot} value={value} nodes={nodes} query={query} setQuery={setQuery} onChange={onChange} />
      )}
    </Field>
  )
}

function NodeSelector({
  slot,
  value,
  nodes,
  query,
  setQuery,
  onChange,
}: {
  slot: TemplateSourceSlot
  value: Extract<ProfileSlotBinding, { mode: 'node' }>
  nodes: NodeOption[]
  query: string
  setQuery: (value: string) => void
  onChange: (value: ProfileSlotBinding) => void
}) {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visible = nodes.filter((node) => !normalizedQuery || node.name.toLocaleLowerCase().includes(normalizedQuery))
  const groups = new Map<string, NodeOption[]>()
  for (const node of visible) groups.set(node.sourceId, [...(groups.get(node.sourceId) || []), node])
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const unavailable = value.nodeIds.filter((id) => {
    const node = nodesById.get(id)
    return !node || !node.enabled || !node.sourceEnabled
  })

  return (
    <div className="flex flex-col gap-3">
      <Field data-invalid={!value.nodeIds.length}>
        <div className="flex items-center justify-between gap-2">
          <FieldLabel htmlFor={`node-search-${slot.key}`}>搜索节点</FieldLabel>
          <Badge variant="secondary">已选 {value.nodeIds.length}</Badge>
        </div>
        <Input
          id={`node-search-${slot.key}`}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="输入节点名称"
        />
        <div className="flex max-h-64 flex-col gap-3 overflow-y-auto rounded-lg border p-2">
          {[...groups].map(([sourceId, items]) => (
            <div key={sourceId} className="flex flex-col gap-1">
              <p className="px-1 text-xs font-medium text-muted-foreground">{items[0].sourceName}</p>
              {items.map((node) => {
                const checked = value.nodeIds.includes(node.id)
                const enabled = node.enabled && node.sourceEnabled
                return (
                  <label
                    key={node.id}
                    htmlFor={`node-${slot.key}-${node.id}`}
                    className={cn(
                      'flex items-center gap-2 rounded-md p-2 text-sm',
                      enabled || checked ? 'cursor-pointer hover:bg-muted' : 'cursor-not-allowed opacity-50',
                      checked && 'bg-muted',
                    )}
                  >
                    <Checkbox
                      id={`node-${slot.key}-${node.id}`}
                      checked={checked}
                      disabled={!enabled && !checked}
                      onCheckedChange={() =>
                        onChange({
                          ...value,
                          nodeIds: checked ? value.nodeIds.filter((id) => id !== node.id) : [...value.nodeIds, node.id],
                        })
                      }
                      aria-invalid={!value.nodeIds.length}
                    />
                    <span className="min-w-0 truncate">{node.name}</span>
                  </label>
                )
              })}
            </div>
          ))}
          {!visible.length && <p className="p-3 text-center text-sm text-muted-foreground">没有匹配的节点</p>}
        </div>
        {!value.nodeIds.length && <FieldError>请至少选择一个节点</FieldError>}
      </Field>
      {unavailable.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>已选节点中有 {unavailable.length} 个不可用，请移除后保存。</span>
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
