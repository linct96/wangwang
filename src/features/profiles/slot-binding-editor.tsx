import { useMemo } from 'react'
import type { NodeOption, ProfileNodeBinding, Source, TagOption, TemplateSourceSlot } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { cn } from '@/lib/utils'
import { DirectNodeBindingEditor } from './direct-node-binding-editor'
import { SelectionActionButton } from './selection-action-button'

function regexError(value: string | null) {
  if (!value) return false
  try {
    new RegExp(value)
    return false
  } catch {
    return true
  }
}

function RegexFilterInputs({
  slotKey,
  includeRegex,
  excludeRegex,
  includeInvalid,
  excludeInvalid,
  onChange,
}: {
  slotKey: string
  includeRegex: string | null
  excludeRegex: string | null
  includeInvalid: boolean
  excludeInvalid: boolean
  onChange: (patch: { includeRegex: string | null; excludeRegex: string | null }) => void
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Field data-invalid={includeInvalid}>
        <FieldLabel htmlFor={`include-${slotKey}`}>节点筛选</FieldLabel>
        <Input
          id={`include-${slotKey}`}
          value={includeRegex || ''}
          maxLength={200}
          placeholder="例如：香港|HK|日本|JP"
          aria-invalid={includeInvalid}
          onChange={(event) => onChange({ includeRegex: event.target.value || null, excludeRegex })}
        />
        {includeInvalid && <FieldError>正则表达式语法无效</FieldError>}
      </Field>

      <Field data-invalid={excludeInvalid}>
        <FieldLabel htmlFor={`exclude-${slotKey}`}>节点过滤</FieldLabel>
        <Input
          id={`exclude-${slotKey}`}
          value={excludeRegex || ''}
          maxLength={200}
          placeholder="例如：剩余|到期|官网|倍率"
          aria-invalid={excludeInvalid}
          onChange={(event) => onChange({ includeRegex, excludeRegex: event.target.value || null })}
        />
        {excludeInvalid && <FieldError>正则表达式语法无效</FieldError>}
      </Field>
    </div>
  )
}

export function SlotBindingEditor({
  slot,
  value,
  sources,
  nodes,
  tags,
  onChange,
}: {
  slot: TemplateSourceSlot
  value: ProfileNodeBinding
  sources: Source[]
  nodes: NodeOption[]
  tags: TagOption[]
  onChange: (value: ProfileNodeBinding) => void
}) {
  const includeInvalid = (value.mode === 'source' || value.mode === 'tag') && regexError(value.includeRegex)
  const excludeInvalid = (value.mode === 'source' || value.mode === 'tag') && regexError(value.excludeRegex)

  function setMode(mode: ProfileNodeBinding['mode']) {
    if (mode === value.mode) return
    if (mode === 'source') onChange({ mode, sourceIds: [], includeRegex: null, excludeRegex: null })
    else if (mode === 'node') onChange({ mode, nodeIds: [], missingNodeIds: [] })
    else onChange({ mode, tags: [], includeRegex: null, excludeRegex: null })
  }

  // 统计已选源的覆盖节点数
  const totalNodesInSelectedSources = useMemo(() => {
    if (value.mode !== 'source') return 0
    const selectedSet = new Set(value.sourceIds)
    return sources.filter((s) => selectedSet.has(s.id)).reduce((sum, s) => sum + (s.nodeCount || 0), 0)
  }, [value, sources])

  // 全选可用节点源
  function selectAllSources() {
    if (value.mode !== 'source') return
    const allEnabledIds = sources.filter((s) => s.enabled).map((s) => s.id)
    onChange({ ...value, sourceIds: allEnabledIds })
  }

  // 清空节点源
  function clearSources() {
    if (value.mode !== 'source') return
    onChange({ ...value, sourceIds: [] })
  }

  // 统计每个标签覆盖的可用节点数
  const tagNodeCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const tag of tags) counts.set(tag.name, 0)
    for (const node of nodes) {
      if (!node.enabled || !node.sourceEnabled) continue
      for (const t of node.tags) {
        counts.set(t, (counts.get(t) || 0) + 1)
      }
    }
    return counts
  }, [tags, nodes])

  // 统计已选标签覆盖的可用节点数
  const totalNodesInSelectedTags = useMemo(() => {
    if (value.mode !== 'tag') return 0
    const selectedTags = new Set(value.tags)
    let count = 0
    for (const node of nodes) {
      if (!node.enabled || !node.sourceEnabled) continue
      if (node.tags.some((t) => selectedTags.has(t))) count++
    }
    return count
  }, [value, nodes])

  // 全选标签（最多20个）
  function selectAllTags() {
    if (value.mode !== 'tag') return
    onChange({ ...value, tags: tags.slice(0, 20).map((t) => t.name) })
  }

  // 清空标签
  function clearTags() {
    if (value.mode !== 'tag') return
    onChange({ ...value, tags: [] })
  }

  return (
    <div className="slot-workspace">
      {/* 模式切换 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 min-h-9">
        <FieldLabel className="mb-0 text-sm font-semibold text-foreground">节点来源方式</FieldLabel>
        <Segmented
          value={value.mode}
          onChange={(val) => setMode(val as ProfileNodeBinding['mode'])}
          options={[
            { value: 'source', label: '按节点源' },
            { value: 'tag', label: '按节点标签' },
            { value: 'node', label: '指定节点' },
          ]}
          className="w-full sm:w-auto shrink-0"
        />
      </div>

      <div className="h-px bg-border/60" />

      {value.mode === 'source' ? (
        <div className="slot-source-form">
          {/* 节点源选择 */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 min-h-8">
              <div className="flex items-center gap-2 flex-wrap">
                <FieldLabel className="mb-0 text-sm font-medium">选择接入节点源</FieldLabel>
                <Badge variant="secondary" className="text-xs font-normal text-muted-foreground">
                  已选 {value.sourceIds.length} / {sources.length} 个源
                  {value.sourceIds.length > 0 ? `，共 ${totalNodesInSelectedSources} 个节点` : ''}
                </Badge>
              </div>

              <div className="flex items-center gap-1.5">
                <SelectionActionButton
                  count={value.sourceIds.length}
                  disabled={!sources.some((s) => s.enabled)}
                  onSelectAll={selectAllSources}
                  onClear={clearSources}
                />
              </div>
            </div>

            <div className="source-picker-grid">
              {sources.map((source) => {
                const checked = value.sourceIds.includes(source.id)
                return (
                  <label
                    key={source.id}
                    htmlFor={`source-${slot.key}-${source.id}`}
                    className={cn(
                      'source-picker-item',
                      checked && 'source-picker-item-selected',
                      !source.enabled && !checked && 'source-picker-item-disabled',
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
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
                        className="size-4"
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="font-medium text-xs truncate" title={source.name}>
                          {source.name}
                        </span>
                        {!source.enabled && <span className="text-[11px] text-destructive">已停用</span>}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {source.nodeNameFilter && (
                        <Badge variant="outline" className="text-[10px] h-4 px-1 text-muted-foreground">
                          已滤
                        </Badge>
                      )}
                      <Badge variant="secondary" className="text-[11px] h-5 px-1.5 font-mono">
                        {source.nodeCount} 节点
                      </Badge>
                    </div>
                  </label>
                )
              })}
            </div>

            {!sources.length && (
              <p className="text-xs text-muted-foreground py-3 text-center border rounded-md border-dashed">
                系统中暂无节点源，请先在「节点源」页面添加订阅链接。
              </p>
            )}
          </div>

          <div className="h-px bg-border/60" />

          {/* 正则表达式过滤表单 */}
          <RegexFilterInputs
            slotKey={slot.key}
            includeRegex={value.includeRegex}
            excludeRegex={value.excludeRegex}
            includeInvalid={includeInvalid}
            excludeInvalid={excludeInvalid}
            onChange={({ includeRegex, excludeRegex }) => onChange({ ...value, includeRegex, excludeRegex })}
          />
        </div>
      ) : value.mode === 'tag' ? (
        <div className="slot-source-form">
          {/* 节点标签选择 */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 min-h-8">
              <div className="flex items-center gap-2 flex-wrap">
                <FieldLabel className="mb-0 text-sm font-medium">选择节点标签</FieldLabel>
                <Badge variant="secondary" className="text-xs font-normal text-muted-foreground">
                  已选 {value.tags.length} / {tags.length} 个标签
                  {value.tags.length > 0 ? `，共 ${totalNodesInSelectedTags} 个节点` : ''}
                </Badge>
              </div>

              <div className="flex items-center gap-1.5">
                <SelectionActionButton
                  count={value.tags.length}
                  disabled={tags.length === 0}
                  onSelectAll={selectAllTags}
                  onClear={clearTags}
                />
              </div>
            </div>

            <div className="source-picker-grid">
              {tags.map((tag) => {
                const checked = value.tags.includes(tag.name)
                const count = tagNodeCounts.get(tag.name) || 0
                return (
                  <label
                    key={tag.id}
                    htmlFor={`tag-${slot.key}-${tag.id}`}
                    className={cn('source-picker-item', checked && 'source-picker-item-selected')}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Checkbox
                        id={`tag-${slot.key}-${tag.id}`}
                        checked={checked}
                        onCheckedChange={() =>
                          onChange({
                            ...value,
                            tags: checked ? value.tags.filter((t) => t !== tag.name) : [...value.tags, tag.name],
                          })
                        }
                        className="size-4"
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="font-medium text-xs truncate" title={tag.name}>
                          {tag.name}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge variant="secondary" className="text-[11px] h-5 px-1.5 font-mono">
                        {count} 节点
                      </Badge>
                    </div>
                  </label>
                )
              })}
            </div>

            {!tags.length && (
              <p className="text-xs text-muted-foreground py-3 text-center border rounded-md border-dashed">
                系统中暂无节点标签，可在「节点管理」或「节点源」中为节点添加标签。
              </p>
            )}
          </div>

          <div className="h-px bg-border/60" />

          {/* 正则表达式过滤表单 */}
          <RegexFilterInputs
            slotKey={slot.key}
            includeRegex={value.includeRegex}
            excludeRegex={value.excludeRegex}
            includeInvalid={includeInvalid}
            excludeInvalid={excludeInvalid}
            onChange={({ includeRegex, excludeRegex }) => onChange({ ...value, includeRegex, excludeRegex })}
          />
        </div>
      ) : (
        <DirectNodeBindingEditor slot={slot} value={value} nodes={nodes} onChange={onChange} />
      )}
    </div>
  )
}
