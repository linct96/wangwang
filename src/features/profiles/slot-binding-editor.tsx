import { useMemo } from 'react'
import { CheckSquare, X } from 'lucide-react'
import type { NodeOption, ProfileNodeBinding, Source, TemplateSourceSlot } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { cn } from '@/lib/utils'
import { DirectNodeBindingEditor } from './direct-node-binding-editor'

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
  value: ProfileNodeBinding
  sources: Source[]
  nodes: NodeOption[]
  onChange: (value: ProfileNodeBinding) => void
}) {
  const includeInvalid = value.mode === 'source' && regexError(value.includeRegex)
  const excludeInvalid = value.mode === 'source' && regexError(value.excludeRegex)

  function setMode(mode: 'source' | 'node') {
    if (mode === value.mode) return
    onChange(
      mode === 'source'
        ? { mode, sourceIds: [], includeRegex: null, excludeRegex: null }
        : { mode, nodeIds: [], missingNodeIds: [] },
    )
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

  return (
    <div className="slot-workspace">
      {/* 模式切换 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 min-h-9">
        <FieldLabel className="mb-0 text-sm font-semibold text-foreground">节点来源方式</FieldLabel>
        <Segmented
          value={value.mode}
          onChange={(val) => setMode(val as 'source' | 'node')}
          options={[
            { value: 'source', label: '按节点源动态分流' },
            { value: 'node', label: '指定固定节点列表' },
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
                <Badge variant={value.sourceIds.length > 0 ? 'default' : 'secondary'} className="text-xs">
                  已选 {value.sourceIds.length} / {sources.length} 个源
                </Badge>
                {value.sourceIds.length > 0 && (
                  <span className="text-xs text-muted-foreground hidden sm:inline">
                    (覆盖约 {totalNodesInSelectedSources} 个节点)
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={selectAllSources}
                  className="h-7 px-2.5 gap-1 text-xs font-medium border-border/80 hover:bg-accent/60"
                >
                  <CheckSquare className="size-3.5" />
                  全选可用源
                </Button>
                {value.sourceIds.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={clearSources}
                    className="h-7 px-2.5 gap-1 text-xs font-medium border-border/80 hover:text-destructive hover:bg-destructive/10"
                  >
                    <X className="size-3.5" />
                    清空
                  </Button>
                )}
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field data-invalid={includeInvalid}>
              <FieldLabel htmlFor={`include-${slot.key}`}>节点筛选</FieldLabel>
              <Input
                id={`include-${slot.key}`}
                value={value.includeRegex || ''}
                maxLength={200}
                placeholder="例如：香港|HK|日本|JP"
                aria-invalid={includeInvalid}
                onChange={(event) => onChange({ ...value, includeRegex: event.target.value || null })}
              />
              {includeInvalid && <FieldError>正则表达式语法无效</FieldError>}
            </Field>

            <Field data-invalid={excludeInvalid}>
              <FieldLabel htmlFor={`exclude-${slot.key}`}>节点过滤</FieldLabel>
              <Input
                id={`exclude-${slot.key}`}
                value={value.excludeRegex || ''}
                maxLength={200}
                placeholder="例如：剩余|到期|官网|倍率"
                aria-invalid={excludeInvalid}
                onChange={(event) => onChange({ ...value, excludeRegex: event.target.value || null })}
              />
              {excludeInvalid && <FieldError>正则表达式语法无效</FieldError>}
            </Field>
          </div>
        </div>
      ) : (
        <DirectNodeBindingEditor slot={slot} value={value} nodes={nodes} onChange={onChange} />
      )}
    </div>
  )
}
