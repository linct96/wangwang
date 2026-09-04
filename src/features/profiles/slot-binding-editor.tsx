import type { NodeOption, ProfileSlotBinding, Source, TemplateSourceSlot } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
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
  value: ProfileSlotBinding
  sources: Source[]
  nodes: NodeOption[]
  onChange: (value: ProfileSlotBinding) => void
}) {
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
    <Field className="slot-binding-card" data-invalid={includeInvalid || excludeInvalid}>
      <div className="slot-binding-heading">
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
            <div className="source-binding-options">
              {sources.map((source) => {
                const checked = value.sourceIds.includes(source.id)
                return (
                  <label
                    key={source.id}
                    htmlFor={`source-${slot.key}-${source.id}`}
                    className={cn(
                      'source-binding-option',
                      source.enabled || checked ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
                      checked && 'source-binding-option-selected',
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

          <div className="source-binding-regex">
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
        <DirectNodeBindingEditor slot={slot} value={value} nodes={nodes} onChange={onChange} />
      )}
    </Field>
  )
}
