import { useMemo, useState } from 'react'
import { AlertTriangle, Database, LoaderCircle, Plus, Search } from 'lucide-react'
import { AppDialog } from '@/components/app-primitives'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RuleTargetSelect } from '../rules'
import { canUseNoResolve } from '../validation'
import { newRule, newRuleProvider } from '../yaml-adapter'
import { targetLabel, type RuleSetRuleDraft, type RuleTargetDraft, type VisualTemplateDraft } from '../model'
import { RULE_SET_PRESETS } from './catalog'
import {
  createProviderFromPreset,
  findPresetProvider,
  findProviderRule,
  providerMatchesPreset,
  targetsEqual,
} from './helpers'
import type {
  ApplyRuleSetPresetOptions,
  RuleSetPreset,
  RuleSetPresetCategory,
  RuleSetPresetMode,
  RuleSetPresetSource,
} from './types'
import { useRuleSetPresetCatalog } from './use-preset-catalog'

const MAX_VISIBLE_PRESETS = 200

const categoryLabels: Record<RuleSetPresetCategory, string> = {
  common: '常用',
  ai: 'AI',
  social: '社交',
  media: '流媒体',
  ads: '广告',
  china: '国内',
  development: '开发服务',
  service: '服务',
}

const sourceLabels: Record<RuleSetPresetSource, string> = {
  metacubex: 'MetaCubeX',
  loyalsoldier: 'Loyalsoldier',
}

function initialTarget(preset: RuleSetPreset, draft: VisualTemplateDraft): RuleTargetDraft {
  if (preset.defaultTarget === 'DIRECT' || preset.defaultTarget === 'REJECT') {
    return { kind: 'builtin', value: preset.defaultTarget }
  }
  const group =
    draft.groups.find((item) => item.name === preset.defaultTarget) || draft.groups.find((item) => item.name)
  return group ? { kind: 'group', groupId: group.id } : { kind: 'builtin', value: 'DIRECT' }
}

function initialSelection(preset: RuleSetPreset, draft: VisualTemplateDraft): ApplyRuleSetPresetOptions {
  const target = initialTarget(preset, draft)
  return {
    presetId: preset.id,
    providerId: newRuleProvider(draft.ruleProviders).id,
    ruleId: newRule(target).id,
    target,
    providerConflict: 'keep',
    ruleConflict: 'keep',
    noResolve: preset.noResolve ?? false,
  }
}

function providerDifferences(provider: VisualTemplateDraft['ruleProviders'][number], preset: RuleSetPreset) {
  if (provider.kind === 'raw') return [{ label: '配置', current: '高级 YAML', preset: '结构化预设' }]
  const expected = preset.provider
  const values: Array<[string, unknown, unknown]> = [
    ['类型', provider.type, expected.type],
    ['行为', provider.behavior, expected.behavior],
    ['格式', provider.format, expected.format],
    ['URL', provider.url, expected.url],
    ['缓存路径', provider.path, expected.path],
    ['更新间隔', provider.interval, expected.interval],
    [
      '其他配置',
      provider.proxy !== undefined ||
      provider.pathInBundle !== undefined ||
      provider.sizeLimit !== undefined ||
      provider.header !== undefined ||
      provider.payload !== undefined ||
      Object.keys(provider.extras).length
        ? '存在自定义字段'
        : undefined,
      undefined,
    ],
  ]
  return values
    .filter(([, current, next]) => current !== next)
    .map(([label, current, next]) => ({
      label,
      current: current === undefined ? '未设置' : String(current),
      preset: next === undefined ? '未设置' : String(next),
    }))
}

export function RuleSetPresetDialog({
  mode,
  draft,
  onApply,
  children,
}: {
  mode: RuleSetPresetMode
  draft: VisualTemplateDraft
  onApply: (selections: ApplyRuleSetPresetOptions[], presets: RuleSetPreset[]) => void
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<RuleSetPresetSource | 'all'>('all')
  const [category, setCategory] = useState<RuleSetPresetCategory | 'all'>('all')
  const [selections, setSelections] = useState<Record<string, ApplyRuleSetPresetOptions>>({})
  const catalog = useRuleSetPresetCatalog(open)
  const presets = catalog.data?.items.length ? catalog.data.items : RULE_SET_PRESETS

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return presets.filter(
      (preset) =>
        (source === 'all' || preset.source === source) &&
        (category === 'all' || preset.category === category) &&
        (!keyword ||
          [preset.name, preset.provider.name, preset.description, ...(preset.keywords || [])]
            .filter(Boolean)
            .some((value) => value!.toLowerCase().includes(keyword))),
    )
  }, [category, presets, query, source])
  const visiblePresets = filtered.slice(0, MAX_VISIBLE_PRESETS)

  function show() {
    setQuery('')
    setSource('all')
    setCategory('all')
    setSelections({})
    setOpen(true)
  }

  function updateSelection(preset: RuleSetPreset, patch: Partial<ApplyRuleSetPresetOptions>) {
    setSelections((current) => ({
      ...current,
      [preset.id]: { ...(current[preset.id] || initialSelection(preset, draft)), ...patch },
    }))
  }

  function supportsNoResolve(preset: RuleSetPreset, selection: ApplyRuleSetPresetOptions) {
    const existing = findPresetProvider(draft.ruleProviders, preset)
    const provider =
      existing && selection.providerConflict === 'keep'
        ? existing
        : createProviderFromPreset(preset, selection.providerId)
    const rule: RuleSetRuleDraft = {
      kind: 'structured',
      id: 'preset-preview',
      type: 'RULE-SET',
      provider: { kind: 'provider', providerId: provider.id },
      target: selection.target || { kind: 'builtin', value: 'DIRECT' },
      noResolve: false,
    }
    return canUseNoResolve(rule, { ruleProviders: [provider] })
  }

  const selectedCount = Object.keys(selections).length
  return (
    <>
      <span onClick={show}>{children}</span>
      {open && (
        <AppDialog
          title={mode === 'provider-only' ? '添加规则集数据源' : '从规则集添加'}
          contentClassName="template-dialog sm:max-w-3xl"
          onClose={() => setOpen(false)}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索规则集..."
              className="pl-8"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select value={source} onValueChange={(value: RuleSetPresetSource | 'all') => setSource(value)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部来源</SelectItem>
                <SelectItem value="metacubex">MetaCubeX</SelectItem>
                <SelectItem value="loyalsoldier">Loyalsoldier</SelectItem>
              </SelectContent>
            </Select>
            <Select value={category} onValueChange={(value: RuleSetPresetCategory | 'all') => setCategory(value)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部分类</SelectItem>
                {Object.entries(categoryLabels)
                  .filter(([value]) => presets.some((preset) => preset.category === value))
                  .map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {(catalog.loading || catalog.error || catalog.data?.stale) && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {catalog.loading ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <AlertTriangle className="size-3.5 text-amber-500" />
              )}
              {catalog.loading
                ? '正在同步社区目录，内置预设可正常使用'
                : catalog.error
                  ? '社区目录加载失败，当前使用内置预设'
                  : '社区目录暂时使用上次同步的数据'}
            </p>
          )}

          <div className="max-h-[min(56vh,520px)] space-y-2 overflow-y-auto pr-1">
            {visiblePresets.map((preset) => {
              const selection = selections[preset.id]
              const existingProvider = findPresetProvider(draft.ruleProviders, preset)
              const providerConflict = Boolean(existingProvider && !providerMatchesPreset(existingProvider, preset))
              const differences = existingProvider ? providerDifferences(existingProvider, preset) : []
              const existingRule = existingProvider ? findProviderRule(draft.rules, existingProvider.id) : undefined
              const ruleConflict = Boolean(
                selection &&
                existingRule?.kind === 'structured' &&
                existingRule.type === 'RULE-SET' &&
                selection.target &&
                !targetsEqual(existingRule.target, selection.target),
              )
              return (
                <div key={preset.id} className="rounded-md border bg-card p-3">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id={`preset-${mode}-${preset.id}`}
                      checked={Boolean(selection)}
                      onCheckedChange={(checked) =>
                        setSelections((current) => {
                          if (checked === true) return { ...current, [preset.id]: initialSelection(preset, draft) }
                          const { [preset.id]: _, ...rest } = current
                          return rest
                        })
                      }
                    />
                    <label htmlFor={`preset-${mode}-${preset.id}`} className="min-w-0 flex-1 cursor-pointer">
                      <span className="flex flex-wrap items-center gap-2">
                        <strong className="text-sm">{preset.name}</strong>
                        <Badge variant="outline">{categoryLabels[preset.category]}</Badge>
                        {existingProvider && (
                          <Badge variant={providerConflict ? 'destructive' : 'secondary'}>
                            {providerConflict ? '存在冲突' : '已存在'}
                          </Badge>
                        )}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {sourceLabels[preset.source]} · {preset.description}
                      </span>
                      {existingRule?.kind === 'structured' && existingRule.type === 'RULE-SET' && (
                        <span className="mt-1 block text-xs text-muted-foreground">
                          已配置：{targetLabel(existingRule.target, draft.groups)}
                        </span>
                      )}
                    </label>
                  </div>

                  {selection && (providerConflict || mode === 'provider-and-rule') && (
                    <div className="mt-3 space-y-3 border-t pt-3 pl-7">
                      {providerConflict && existingProvider && (
                        <div className="space-y-2 text-xs">
                          <p className="text-destructive">已有同名规则集数据源，当前配置不会被静默覆盖。</p>
                          <div className="overflow-hidden rounded-md border">
                            {differences.map((difference) => (
                              <div
                                key={difference.label}
                                className="grid grid-cols-[72px_1fr] gap-2 border-b p-2 last:border-b-0"
                              >
                                <span className="font-medium">{difference.label}</span>
                                <span className="min-w-0 space-y-1 text-muted-foreground">
                                  <span className="block break-all">当前：{difference.current}</span>
                                  <span className="block break-all">预设：{difference.preset}</span>
                                </span>
                              </div>
                            ))}
                          </div>
                          <Segmented
                            value={selection.providerConflict}
                            onChange={(value) => updateSelection(preset, { providerConflict: value })}
                            options={[
                              { value: 'keep', label: '保留现有' },
                              { value: 'replace', label: '使用预设覆盖' },
                            ]}
                          />
                        </div>
                      )}

                      {mode === 'provider-and-rule' && selection.target && (
                        <div className="space-y-2">
                          <span className="text-xs font-medium">目标策略</span>
                          <RuleTargetSelect
                            groups={draft.groups}
                            value={selection.target}
                            onChange={(target) => updateSelection(preset, { target })}
                            className="w-full"
                          />
                          {ruleConflict && existingRule?.kind === 'structured' && existingRule.type === 'RULE-SET' && (
                            <div className="space-y-2 text-xs">
                              <p className="text-destructive">
                                已有分流规则：{targetLabel(existingRule.target, draft.groups)} →{' '}
                                {targetLabel(selection.target, draft.groups)}
                              </p>
                              <Segmented
                                value={selection.ruleConflict}
                                onChange={(value) => updateSelection(preset, { ruleConflict: value })}
                                options={[
                                  { value: 'keep', label: '保留当前' },
                                  { value: 'replace', label: '修改目标' },
                                ]}
                              />
                            </div>
                          )}
                          {supportsNoResolve(preset, selection) && (
                            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                              <Checkbox
                                checked={selection.noResolve}
                                onCheckedChange={(checked) => updateSelection(preset, { noResolve: checked === true })}
                              />
                              no-resolve
                            </label>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            {!filtered.length && <p className="py-10 text-center text-sm text-muted-foreground">没有匹配的规则集</p>}
            {filtered.length > visiblePresets.length && (
              <p className="py-3 text-center text-xs text-muted-foreground">
                当前显示前 {MAX_VISIBLE_PRESETS} 项，请输入关键词继续查找
              </p>
            )}
          </div>

          <div className="dialog-actions">
            <span className="mr-auto flex items-center gap-1.5 text-sm text-muted-foreground">
              <Database className="size-4" />
              已选择 {selectedCount} 项
            </span>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              disabled={!selectedCount}
              onClick={() => {
                onApply(Object.values(selections), presets)
                setOpen(false)
              }}
            >
              <Plus data-icon="inline-start" />
              添加
            </Button>
          </div>
        </AppDialog>
      )}
    </>
  )
}
