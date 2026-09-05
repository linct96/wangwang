import { useMemo } from 'react'
import { CheckSquare, Sparkles, X } from 'lucide-react'
import type { NodeOption, ProfileSlotBinding, Source, TemplateSourceSlot } from '@/api/types'
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

// 常用正则预设
const INCLUDE_REGEX_PRESETS = [
  { label: '香港 (HK)', value: '香港|HK' },
  { label: '日本 (JP)', value: '日本|JP' },
  { label: '新加坡 (SG)', value: '新加坡|SG|狮城' },
  { label: '美国 (US)', value: '美国|US' },
  { label: '台湾 (TW)', value: '台湾|TW' },
]

const EXCLUDE_REGEX_PRESETS = [
  { label: '官网/剩余', value: '官网|剩余|到期|通知|网址' },
  { label: '高倍率', value: '倍率|[2-9]\\d*x' },
  { label: '测试节点', value: '测试|test|temp' },
]

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

  // 快捷追加/填充正则
  function applyRegexPreset(type: 'include' | 'exclude', presetVal: string) {
    if (value.mode !== 'source') return
    const currentVal = (type === 'include' ? value.includeRegex : value.excludeRegex) || ''
    let nextVal = ''
    if (!currentVal.trim()) {
      nextVal = presetVal
    } else {
      const parts = currentVal.split('|').map((s) => s.trim())
      const presetParts = presetVal.split('|').map((s) => s.trim())
      const merged = Array.from(new Set([...parts, ...presetParts]))
      nextVal = merged.join('|')
    }

    if (type === 'include') {
      onChange({ ...value, includeRegex: nextVal })
    } else {
      onChange({ ...value, excludeRegex: nextVal })
    }
  }

  return (
    <div className="slot-workspace">
      {/* 模式切换 */}
      <div className="slot-mode-selector-wrap">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-foreground">节点分流策略</span>
          <span className="text-xs text-muted-foreground">选择按节点源自动拉取节点，或手动挑选排列特定节点</span>
        </div>
        <Segmented
          value={value.mode}
          onChange={(val) => setMode(val as 'source' | 'node')}
          options={[
            { value: 'source', label: '按节点源动态分流' },
            { value: 'node', label: '指定固定节点列表' },
          ]}
          className="w-full sm:w-auto"
        />
      </div>

      {value.mode === 'source' ? (
        <div className="slot-source-form">
          {/* 节点源选择 */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FieldLabel className="text-sm font-medium">选择接入节点源</FieldLabel>
                <Badge variant={value.sourceIds.length > 0 ? 'default' : 'secondary'} className="text-xs">
                  已选 {value.sourceIds.length} / {sources.length} 个源
                </Badge>
                {value.sourceIds.length > 0 && (
                  <span className="text-xs text-muted-foreground hidden sm:inline">
                    (覆盖约 {totalNodesInSelectedSources} 个节点)
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={selectAllSources}
                  className="text-xs text-muted-foreground hover:text-foreground h-7 px-2"
                >
                  <CheckSquare className="size-3.5 mr-1" />
                  全选可用源
                </Button>
                {value.sourceIds.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={clearSources}
                    className="text-xs text-muted-foreground hover:text-destructive h-7 px-2"
                  >
                    <X className="size-3.5 mr-1" />
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
            {!value.sourceIds.length && <FieldError>请至少选择一个节点源以提取节点</FieldError>}
          </div>

          {/* 正则表达式规则过滤 */}
          <div className="source-regex-section">
            <div className="source-regex-header">
              <div className="flex items-center gap-1.5">
                <Sparkles className="size-3.5 text-primary" />
                <span className="text-xs font-semibold">节点名称正则过滤</span>
              </div>
              <span className="text-[11px] text-muted-foreground">仅在当前槽位生效，不影响节点源本身</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field data-invalid={includeInvalid}>
                <div className="flex items-center justify-between">
                  <FieldLabel htmlFor={`include-${slot.key}`} className="text-xs font-medium">
                    包含正则 (Include)
                  </FieldLabel>
                  {value.includeRegex && (
                    <button
                      type="button"
                      onClick={() => onChange({ ...value, includeRegex: null })}
                      className="text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      清空
                    </button>
                  )}
                </div>
                <Input
                  id={`include-${slot.key}`}
                  value={value.includeRegex || ''}
                  maxLength={200}
                  placeholder="例如：香港|HK|日本|JP"
                  aria-invalid={includeInvalid}
                  onChange={(event) => onChange({ ...value, includeRegex: event.target.value || null })}
                  className="h-8 text-xs font-mono"
                />
                <div className="regex-preset-row">
                  <span className="regex-preset-label">快捷预设:</span>
                  {INCLUDE_REGEX_PRESETS.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => applyRegexPreset('include', p.value)}
                      className="regex-preset-tag"
                      title={`追加: ${p.value}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                {includeInvalid && <FieldError>正则表达式语法无效</FieldError>}
              </Field>

              <Field data-invalid={excludeInvalid}>
                <div className="flex items-center justify-between">
                  <FieldLabel htmlFor={`exclude-${slot.key}`} className="text-xs font-medium">
                    排除正则 (Exclude)
                  </FieldLabel>
                  {value.excludeRegex && (
                    <button
                      type="button"
                      onClick={() => onChange({ ...value, excludeRegex: null })}
                      className="text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      清空
                    </button>
                  )}
                </div>
                <Input
                  id={`exclude-${slot.key}`}
                  value={value.excludeRegex || ''}
                  maxLength={200}
                  placeholder="例如：剩余|到期|官网|倍率"
                  aria-invalid={excludeInvalid}
                  onChange={(event) => onChange({ ...value, excludeRegex: event.target.value || null })}
                  className="h-8 text-xs font-mono"
                />
                <div className="regex-preset-row">
                  <span className="regex-preset-label">快捷预设:</span>
                  {EXCLUDE_REGEX_PRESETS.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => applyRegexPreset('exclude', p.value)}
                      className="regex-preset-tag"
                      title={`追加: ${p.value}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                {excludeInvalid && <FieldError>正则表达式语法无效</FieldError>}
              </Field>
            </div>
          </div>
        </div>
      ) : (
        <DirectNodeBindingEditor slot={slot} value={value} nodes={nodes} onChange={onChange} />
      )}
    </div>
  )
}
