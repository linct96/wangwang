import { memo, useEffect, useRef, useState } from 'react'
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
  Database,
} from 'lucide-react'
import { IconButton } from '@/components/app-primitives'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type {
  ProxyGroupDraft,
  RuleDraft,
  RuleProviderDraft,
  StructuredRuleDraft,
  SupportedRuleType,
  VisualIssue,
} from '../model'
import { canUseNoResolve, resolvePresetNoResolve } from '../validation'
import { RuleProviderCombobox } from '../rule-providers'
import { GeoMatchValueCombobox } from './geo-match-value-combobox'
import type { GeoProvider } from './geo-catalog'
import { RuleTargetSelect } from './rule-target-select'

const ruleTypes: SupportedRuleType[] = [
  'DOMAIN',
  'DOMAIN-SUFFIX',
  'DOMAIN-KEYWORD',
  'GEOSITE',
  'GEOIP',
  'IP-CIDR',
  'IP-CIDR6',
  'RULE-SET',
  'MATCH',
]

function valueAfterTypeChange(type: SupportedRuleType, nextType: SupportedRuleType, value?: string) {
  if (nextType === 'MATCH') return undefined
  if (nextType === 'RULE-SET' || type === 'RULE-SET') return ''
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
    case 'RULE-SET':
      return {
        badgeClass: 'bg-cyan-500/10 text-cyan-800 dark:text-cyan-300 border-cyan-200 dark:border-cyan-900/60',
        colorClass: 'text-cyan-700 dark:text-cyan-300',
        Icon: Database,
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

export function changeStructuredRule(
  rule: StructuredRuleDraft,
  type: SupportedRuleType,
  value: string | undefined,
  ruleProviders: RuleProviderDraft[],
): StructuredRuleDraft {
  if (type === 'MATCH') return { kind: 'structured', id: rule.id, type, target: rule.target, noResolve: false }
  if (type === 'RULE-SET') {
    const provider = value
      ? { kind: 'provider' as const, providerId: value }
      : rule.type === 'RULE-SET'
        ? rule.provider
        : ruleProviders[0]
          ? { kind: 'provider' as const, providerId: ruleProviders[0].id }
          : { kind: 'raw' as const, value: '' }
    const next: StructuredRuleDraft = {
      kind: 'structured',
      id: rule.id,
      type,
      provider,
      target: rule.target,
      noResolve: resolvePresetNoResolve(
        provider.kind === 'provider' ? ruleProviders.find((item) => item.id === provider.providerId) : undefined,
        true,
      ),
    }
    return canUseNoResolve(next, { ruleProviders }) ? next : { ...next, noResolve: false }
  }
  return {
    kind: 'structured',
    id: rule.id,
    type,
    value: value || '',
    target: rule.target,
    noResolve: ['GEOIP', 'IP-CIDR', 'IP-CIDR6'].includes(type) ? rule.noResolve : false,
  }
}

export function ruleMatcherValue(rule: StructuredRuleDraft) {
  if (rule.type === 'MATCH') return undefined
  if (rule.type === 'RULE-SET') return rule.provider.kind === 'provider' ? rule.provider.providerId : undefined
  return rule.value
}

export function setRuleNoResolve(rule: StructuredRuleDraft, noResolve: boolean): StructuredRuleDraft {
  return rule.type === 'MATCH' ? rule : { ...rule, noResolve }
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
  geoProvider = 'metacubex',
  ruleProviders = [],
  rawProviderValue,
}: {
  type: SupportedRuleType
  value?: string
  mode?: 'inline' | 'form'
  onSave?: (type: SupportedRuleType, value?: string) => void
  onChange?: (type: SupportedRuleType, value?: string) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  placeholder?: string
  geoProvider?: GeoProvider
  ruleProviders?: RuleProviderDraft[]
  rawProviderValue?: string
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
        ) : type === 'RULE-SET' ? (
          ruleProviders.length === 0 && !rawProviderValue ? (
            <div className="template-matcher-match-placeholder">暂无规则集数据源，请先创建规则集数据源</div>
          ) : (
            <RuleProviderCombobox
              providers={ruleProviders}
              value={value}
              rawValue={rawProviderValue}
              onChange={(providerId) => onChange?.(type, providerId)}
            />
          )
        ) : type === 'GEOSITE' || type === 'GEOIP' ? (
          <GeoMatchValueCombobox
            type={type}
            value={value}
            geoProvider={geoProvider}
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
      ) : type === 'RULE-SET' ? (
        <RuleProviderCombobox
          providers={ruleProviders}
          value={value}
          rawValue={rawProviderValue}
          onChange={(providerId) => onSave?.(type, providerId)}
        />
      ) : type === 'GEOSITE' || type === 'GEOIP' ? (
        <GeoMatchValueCombobox
          type={type}
          value={value}
          geoProvider={geoProvider || 'custom'}
          onChange={(next) => onSave?.(type, next)}
        />
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

export const RuleCard = memo(function RuleCard({
  rule,
  groups,
  ruleProviders,
  index,
  isAfterMatch,
  issues,
  onSave,
  onDelete,
  geoProvider = 'metacubex',
}: {
  rule: RuleDraft
  groups: ProxyGroupDraft[]
  ruleProviders: RuleProviderDraft[]
  index: number
  isAfterMatch?: boolean
  issues?: VisualIssue[]
  onSave: (id: string, rule: RuleDraft) => void
  onDelete: (id: string) => void
  geoProvider?: GeoProvider
}) {
  const { ref, handleRef, isDragging } = useSortable({
    id: rule.id,
    index,
  })

  const isMatch = rule.kind === 'structured' && rule.type === 'MATCH'
  const typeMeta = rule.kind === 'structured' ? getRuleTypeMeta(rule.type) : getRuleTypeMeta('RAW')
  const TypeIcon = typeMeta.Icon

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
              onSave={(nextRaw) => onSave(rule.id, { ...rule, raw: nextRaw })}
            />
          </div>
        ) : (
          <div className="template-rule-grid">
            <div className="template-rule-col-matcher">
              <RuleMatcher
                mode="inline"
                type={rule.type}
                value={ruleMatcherValue(rule)}
                rawProviderValue={
                  rule.type === 'RULE-SET' && rule.provider.kind === 'raw' ? rule.provider.value : undefined
                }
                ruleProviders={ruleProviders}
                geoProvider={geoProvider}
                onSave={(nextType, nextValue) =>
                  onSave(rule.id, changeStructuredRule(rule, nextType, nextValue, ruleProviders))
                }
              />
            </div>

            <div className="template-rule-col-arrow">
              <ArrowRight className="template-rule-arrow" />
            </div>

            <div className="template-rule-col-target">
              <div className="template-rule-target-wrapper" onClick={(e) => e.stopPropagation()}>
                <RuleTargetSelect
                  groups={groups}
                  value={rule.target}
                  onChange={(target) => onSave(rule.id, { ...rule, target })}
                  className="w-full min-w-[130px] max-w-[200px] cursor-pointer select-none"
                />
              </div>

              {rule.kind === 'structured' && canUseNoResolve(rule, { ruleProviders }) && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                      <Checkbox
                        checked={rule.noResolve}
                        onCheckedChange={(checked) => onSave(rule.id, setRuleNoResolve(rule, checked === true))}
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

      {hasIssues && (
        <div className="template-rule-error-pill shrink-0" title={issues?.map((i) => i.message).join('\n')}>
          <AlertCircle className="size-3.5" />
          <span>配置异常</span>
        </div>
      )}

      <div className="template-rule-actions">
        <IconButton label="删除规则" onClick={() => onDelete(rule.id)}>
          <Trash2 />
        </IconButton>
      </div>
    </article>
  )
})
