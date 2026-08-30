import { useEffect, useRef, useState } from 'react'
import { useSortable } from '@dnd-kit/react/sortable'
import {
  AlertCircle,
  ArrowRight,
  Check,
  Code,
  Globe,
  GripVertical,
  MapPin,
  Network,
  Pencil,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import { IconButton } from '@/components/app-primitives'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { ProxyGroupDraft, RuleDraft, RuleTargetDraft, SupportedRuleType, VisualIssue } from '../model'
import { GeoMatchValueCombobox } from './geo-match-value-combobox'
import type { GeoDataset } from './geo-catalog'

const ruleTypes: SupportedRuleType[] = [
  'DOMAIN',
  'DOMAIN-SUFFIX',
  'DOMAIN-KEYWORD',
  'GEOSITE',
  'GEOIP',
  'IP-CIDR',
  'IP-CIDR6',
  'MATCH',
]

function valueAfterTypeChange(type: SupportedRuleType, nextType: SupportedRuleType, value?: string) {
  if (nextType === 'MATCH') return undefined
  return type.startsWith('DOMAIN') && nextType.startsWith('DOMAIN') ? value : type === nextType ? value : ''
}

function getRuleTypeMeta(type: string) {
  switch (type) {
    case 'DOMAIN':
    case 'DOMAIN-SUFFIX':
    case 'DOMAIN-KEYWORD':
      return {
        badgeClass: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-900/60',
        colorClass: 'text-blue-600 dark:text-blue-400',
        Icon: Globe,
      }
    case 'GEOSITE':
    case 'GEOIP':
      return {
        badgeClass: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-900/60',
        colorClass: 'text-purple-600 dark:text-purple-400',
        Icon: MapPin,
      }
    case 'IP-CIDR':
    case 'IP-CIDR6':
      return {
        badgeClass: 'bg-amber-500/10 text-amber-800 dark:text-amber-400 border-amber-200 dark:border-amber-900/60',
        colorClass: 'text-amber-600 dark:text-amber-400',
        Icon: Network,
      }
    case 'MATCH':
      return {
        badgeClass: 'bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-200 dark:border-violet-800/60',
        colorClass: 'text-violet-600 dark:text-violet-400',
        Icon: Zap,
      }
    default:
      return {
        badgeClass: 'bg-muted text-muted-foreground border-border',
        colorClass: 'text-muted-foreground',
        Icon: Code,
      }
  }
}

export function InlineValueEdit({
  value,
  placeholder = '输入匹配值...',
  onSave,
}: {
  value: string
  placeholder?: string
  onSave: (nextValue: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  const isDirty = draft.trim() !== value.trim()
  const isValid = draft.trim().length > 0

  useEffect(() => {
    if (editing) {
      setDraft(value)
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing, value])

  function submit() {
    const trimmed = draft.trim()
    if (!trimmed) {
      setEditing(false)
      return
    }
    if (trimmed !== value) {
      onSave(trimmed)
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="template-inline-edit-box" onClick={(e) => e.stopPropagation()}>
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          onBlur={submit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              setEditing(false)
            }
          }}
          aria-invalid={!isValid}
          className="pr-14 font-mono bg-background"
        />
        <div className="template-inline-actions">
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault()
              submit()
            }}
            disabled={!isValid || !isDirty}
            title={!isDirty ? '未修改' : '保存 (Enter)'}
            className="template-inline-btn-save"
          >
            <Check className="size-3.5" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault()
              setEditing(false)
            }}
            title="取消 (Esc)"
            className="template-inline-btn-cancel"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="template-inline-value-display" onClick={(e) => e.stopPropagation()}>
      <code
        className="template-rule-value select-text cursor-text"
        title={value ? `匹配值：${value}` : '未填写匹配值'}
        onDoubleClick={() => setEditing(true)}
      >
        {value || <span className="text-muted-foreground italic font-normal">(未填写)</span>}
      </code>
      <div className="template-inline-hover-actions">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="template-inline-hover-btn"
          title="就地编辑匹配值"
        >
          <Pencil className="size-3" />
        </button>
      </div>
    </div>
  )
}

export function RuleMatcher({
  type,
  value = '',
  mode = 'inline',
  onSave,
  onChange,
  onKeyDown,
  placeholder = '输入匹配值 (如 google.com)',
  dataset = 'full',
}: {
  type: SupportedRuleType
  value?: string
  mode?: 'inline' | 'form'
  onSave?: (type: SupportedRuleType, value?: string) => void
  onChange?: (type: SupportedRuleType, value?: string) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  placeholder?: string
  dataset?: GeoDataset
}) {
  if (mode === 'form') {
    return (
      <div className="template-matcher-form-group" onClick={(e) => e.stopPropagation()}>
        <Select
          value={type}
          onValueChange={(nextType: SupportedRuleType) =>
            onChange?.(nextType, valueAfterTypeChange(type, nextType, value))
          }
        >
          <SelectTrigger className="w-[155px] font-mono">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {ruleTypes.map((t) => {
                const meta = getRuleTypeMeta(t)
                const Icon = meta.Icon
                return (
                  <SelectItem key={t} value={t} className="font-mono">
                    <span className="flex items-center gap-1.5">
                      <Icon className={cn('size-3.5 shrink-0', meta.colorClass)} />
                      <span>{t}</span>
                    </span>
                  </SelectItem>
                )
              })}
            </SelectGroup>
          </SelectContent>
        </Select>

        {type === 'MATCH' ? (
          <div className="template-matcher-match-placeholder">兜底规则（MATCH）</div>
        ) : type === 'GEOSITE' || type === 'GEOIP' ? (
          <GeoMatchValueCombobox
            type={type}
            value={value}
            dataset={dataset}
            onChange={(next) => onChange?.(type, next)}
          />
        ) : (
          <Input
            value={value || ''}
            onChange={(e) => onChange?.(type, e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            className="template-matcher-form-input"
          />
        )}
      </div>
    )
  }

  return (
    <div className="template-matcher-inline-container" onClick={(e) => e.stopPropagation()}>
      <Select
        value={type}
        onValueChange={(nextType: SupportedRuleType) => {
          onSave?.(nextType, valueAfterTypeChange(type, nextType, value))
        }}
      >
        <SelectTrigger className="w-auto font-mono cursor-pointer select-none" title="点击切换规则类型">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {ruleTypes.map((t) => {
              const meta = getRuleTypeMeta(t)
              const Icon = meta.Icon
              return (
                <SelectItem key={t} value={t} className="font-mono">
                  <span className="flex items-center gap-1.5">
                    <Icon className={cn('size-3.5 shrink-0', meta.colorClass)} />
                    <span>{t}</span>
                  </span>
                </SelectItem>
              )
            })}
          </SelectGroup>
        </SelectContent>
      </Select>

      {type === 'MATCH' ? (
        <span className="template-rule-match-desc text-xs">兜底规则（MATCH）</span>
      ) : type === 'GEOSITE' || type === 'GEOIP' ? (
        <GeoMatchValueCombobox type={type} value={value} dataset={dataset} onChange={(next) => onSave?.(type, next)} />
      ) : (
        <InlineValueEdit
          value={value || ''}
          placeholder={placeholder}
          onSave={(nextValue) => onSave?.(type, nextValue)}
        />
      )}
    </div>
  )
}

export function RuleCard({
  rule,
  groups,
  index,
  isAfterMatch,
  issues,
  onSave,
  onDelete,
  dataset = 'full',
}: {
  rule: RuleDraft
  groups: ProxyGroupDraft[]
  index: number
  isAfterMatch?: boolean
  issues?: VisualIssue[]
  onSave: (rule: RuleDraft) => void
  onDelete: () => void
  dataset?: GeoDataset
}) {
  const { ref, handleRef, isDragging } = useSortable({
    id: rule.id,
    index,
  })

  const isMatch = rule.kind === 'structured' && rule.type === 'MATCH'
  const typeMeta = rule.kind === 'structured' ? getRuleTypeMeta(rule.type) : getRuleTypeMeta('RAW')
  const TypeIcon = typeMeta.Icon

  const targetValue =
    rule.kind === 'structured'
      ? rule.target.kind === 'group'
        ? `group:${rule.target.groupId}`
        : rule.target.kind === 'builtin'
          ? rule.target.value
          : `raw:${rule.target.value}`
      : ''

  function handleTargetChange(next: string) {
    if (rule.kind !== 'structured') return
    const newTarget: RuleTargetDraft = next.startsWith('group:')
      ? { kind: 'group', groupId: next.slice(6) }
      : next === 'DIRECT' || next === 'REJECT'
        ? { kind: 'builtin', value: next }
        : { kind: 'raw', value: next.slice(4) }
    onSave({ ...rule, target: newTarget })
  }

  const hasIssues = Boolean(issues && issues.length > 0)

  return (
    <article
      ref={ref}
      className={cn(
        'template-rule-row',
        isDragging && 'template-card-dragging',
        isMatch && 'template-rule-match-row',
        isAfterMatch && 'template-rule-unreachable',
        hasIssues && 'template-rule-issue',
      )}
    >
      <div
        ref={handleRef}
        className="template-drag-handle"
        title="拖拽排序"
        aria-label="拖拽排序"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="template-drag-icon" />
      </div>

      <div className="template-rule-content">
        {rule.kind === 'raw' ? (
          <div className="template-rule-raw">
            <Badge
              variant="outline"
              className={cn('text-xs font-mono shrink-0 gap-1.5 px-2.5 py-0.5', typeMeta.badgeClass)}
            >
              <TypeIcon className="size-3.5" />
              RAW
            </Badge>
            <InlineValueEdit
              value={rule.raw}
              placeholder="输入完整规则内容..."
              onSave={(nextRaw) => onSave({ ...rule, raw: nextRaw })}
            />
          </div>
        ) : (
          <div className="template-rule-grid">
            <div className="template-rule-col-matcher">
              <RuleMatcher
                mode="inline"
                type={rule.type}
                value={rule.value}
                dataset={dataset}
                onSave={(nextType, nextValue) =>
                  onSave({
                    ...rule,
                    type: nextType,
                    value: nextValue,
                    noResolve: ['GEOIP', 'IP-CIDR', 'IP-CIDR6'].includes(nextType) ? rule.noResolve : false,
                  })
                }
              />
            </div>

            <div className="template-rule-col-arrow">
              <ArrowRight className="template-rule-arrow" />
            </div>

            <div className="template-rule-col-target">
              <div className="template-rule-target-wrapper" onClick={(e) => e.stopPropagation()}>
                <Select value={targetValue} onValueChange={handleTargetChange}>
                  <SelectTrigger
                    className="w-full min-w-[130px] max-w-[200px] cursor-pointer select-none"
                    title="点击切换目标策略"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {groups
                        .filter((group) => group.name)
                        .map((group) => (
                          <SelectItem key={group.id} value={`group:${group.id}`}>
                            {group.name}
                          </SelectItem>
                        ))}
                      <SelectItem value="DIRECT">DIRECT</SelectItem>
                      <SelectItem value="REJECT">REJECT</SelectItem>
                      {rule.target.kind === 'raw' && (
                        <SelectItem value={`raw:${rule.target.value}`}>{rule.target.value}（高级）</SelectItem>
                      )}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              {rule.kind === 'structured' && ['GEOIP', 'IP-CIDR', 'IP-CIDR6'].includes(rule.type) && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                      <Checkbox
                        checked={rule.noResolve}
                        onCheckedChange={(checked) => onSave({ ...rule, noResolve: checked === true })}
                      />
                      <span>no-resolve</span>
                    </label>
                  </TooltipTrigger>
                  <TooltipContent>不解析域名，避免额外 DNS 查询</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        )}
      </div>

      {isAfterMatch && (
        <div className="template-rule-warning-pill shrink-0" title="该规则位于 MATCH 兜底规则之后，永远不会生效">
          <AlertCircle className="size-3.5" />
          <span>不可达</span>
        </div>
      )}

      {hasIssues && (
        <div className="template-rule-error-pill shrink-0" title={issues?.map((i) => i.message).join('\n')}>
          <AlertCircle className="size-3.5" />
          <span>配置异常</span>
        </div>
      )}

      <div className="template-rule-actions">
        <IconButton label="删除规则" onClick={onDelete}>
          <Trash2 />
        </IconButton>
      </div>
    </article>
  )
}
