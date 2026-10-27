import { useEffect, useMemo, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertTriangle, Database, LoaderCircle, Plus, RefreshCw, Search } from 'lucide-react'
import { AppDialog } from '@/components/app-primitives'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { newRule, newRuleProvider } from '../yaml-adapter'
import { targetLabel, type RuleTargetDraft, type VisualTemplateDraft } from '../model'
import { applyGhProxyToGithubUrl } from '../geo/presets'
import { RULE_SET_PRESETS, ruleProviderPresetKey } from './catalog'
import { providerMatchesPreset } from './apply-presets'
import type {
  ApplyRuleSetPresetOptions,
  RuleSetPreset,
  RuleSetPresetCategory,
  RuleSetPresetMode,
  RuleSetPresetSource,
} from './types'
import { useRuleSetPresetCatalog } from './use-preset-catalog'

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

const ruleTypeLabels = {
  domain: 'Domain',
  ipcidr: 'IP',
  classical: 'Classical',
} as const

function withRuleTypeSuffix(preset: RuleSetPreset, enabled: boolean): RuleSetPreset {
  if (!enabled) return preset

  const suffix = preset.provider.behavior === 'ipcidr' ? 'ip' : preset.provider.behavior

  const currentSuffix = `-${suffix}`
  const generatedIpSuffix = preset.source === 'metacubex' && preset.provider.behavior === 'ipcidr'
  const providerName = generatedIpSuffix ? preset.provider.name.replace(/-ip$/, '') : preset.provider.name
  const displayName = generatedIpSuffix ? preset.name.replace(/ IP$/i, '') : preset.name

  return {
    ...preset,
    name: `${displayName} ${ruleTypeLabels[preset.provider.behavior]}`,
    provider: {
      ...preset.provider,
      name: `${providerName}${currentSuffix}`,
    },
  }
}

function initialSelection(preset: RuleSetPreset, draft: VisualTemplateDraft): ApplyRuleSetPresetOptions {
  const target: RuleTargetDraft = { kind: 'builtin', value: 'DIRECT' }
  return {
    presetId: preset.id,
    providerId: newRuleProvider(draft.ruleProviders).id,
    ruleId: newRule(target || { kind: 'builtin', value: 'DIRECT' }).id,
    target,
    noResolve: preset.noResolve ?? false,
  }
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
  const [appendTypeSuffix, setAppendTypeSuffix] = useState(true)
  const [preferGhProxy, setPreferGhProxy] = useState(false)
  const [bulkTarget, setBulkTarget] = useState<RuleTargetDraft>({ kind: 'builtin', value: 'DIRECT' })
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
  const configuredTargets = useMemo(() => {
    const providers = new Map(draft.ruleProviders.map((provider) => [provider.id, provider]))
    const targets = new Map<string, Set<string>>()
    draft.rules.forEach((rule) => {
      if (rule.kind !== 'structured' || rule.type !== 'RULE-SET' || rule.provider.kind !== 'provider') return
      const provider = providers.get(rule.provider.providerId)
      const providerKey = provider?.kind === 'structured' ? ruleProviderPresetKey(provider) : undefined
      if (!providerKey) return
      const values = targets.get(providerKey) || new Set<string>()
      values.add(targetLabel(rule.target, draft.groups))
      targets.set(providerKey, values)
    })
    return new Map([...targets].map(([name, values]) => [name, [...values].join('、')]))
  }, [draft.groups, draft.ruleProviders, draft.rules])
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => listElement,
    estimateSize: () => 86,
    getItemKey: (index) => filtered[index].id,
    overscan: 8,
    enabled: open,
  })

  useEffect(() => {
    if (listElement) virtualizer.scrollToOffset(0)
  }, [category, listElement, query, source, virtualizer])

  function show() {
    setQuery('')
    setSource('all')
    setCategory('all')
    setSelections({})
    setAppendTypeSuffix(true)
    setPreferGhProxy(false)
    setBulkTarget({ kind: 'builtin', value: 'DIRECT' })
    setOpen(true)
  }

  const selectedCount = Object.keys(selections).length
  const bulkTargetValue = bulkTarget.kind === 'group' ? `group:${bulkTarget.groupId}` : bulkTarget.value
  const selectedFilteredCount = filtered.reduce((count, preset) => count + (selections[preset.id] ? 1 : 0), 0)
  const allFilteredSelected = filtered.length > 0 && selectedFilteredCount === filtered.length
  const someFilteredSelected = selectedFilteredCount > 0 && !allFilteredSelected
  const staleSources = catalog.data?.sources
    ? (['metacubex', 'loyalsoldier'] as const).filter((source) => catalog.data?.sources?.[source].stale)
    : []
  return (
    <>
      <span onClick={show}>{children}</span>
      {open && (
        <AppDialog
          title={mode === 'provider-only' ? '添加规则集数据源' : '从规则集添加'}
          contentClassName="template-dialog sm:max-w-3xl"
          onClose={() => setOpen(false)}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_10rem_minmax(0,1fr)]">
            <Select
              items={[
                { value: 'all', label: '全部来源' },
                ...Object.entries(sourceLabels).map(([value, label]) => ({ value, label })),
              ]}
              value={source}
              onValueChange={(value: RuleSetPresetSource | 'all' | null) => value !== null && setSource(value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">全部来源</SelectItem>
                  <SelectItem value="metacubex">MetaCubeX</SelectItem>
                  <SelectItem value="loyalsoldier">Loyalsoldier</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select
              items={[
                { value: 'all', label: '全部分类' },
                ...Object.entries(categoryLabels)
                  .filter(([value]) => presets.some((preset) => preset.category === value))
                  .map(([value, label]) => ({ value, label })),
              ]}
              value={category}
              onValueChange={(value: RuleSetPresetCategory | 'all' | null) => value !== null && setCategory(value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">全部分类</SelectItem>
                  {Object.entries(categoryLabels)
                    .filter(([value]) => presets.some((preset) => preset.category === value))
                    .map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <div className="relative">
              <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索规则集..."
                className="pl-8"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <label className="flex shrink-0 cursor-pointer items-center gap-1.5">
              <Checkbox
                aria-label="全选"
                checked={allFilteredSelected}
                indeterminate={someFilteredSelected}
                onCheckedChange={(checked) =>
                  setSelections((current) => {
                    const next = { ...current }
                    filtered.forEach((preset) => {
                      if (checked === true) {
                        const effectivePreset =
                          mode === 'provider-only' ? withRuleTypeSuffix(preset, appendTypeSuffix) : preset
                        if (
                          mode === 'provider-only' &&
                          appendTypeSuffix &&
                          draft.ruleProviders.some((provider) => providerMatchesPreset(provider, effectivePreset))
                        )
                          return
                        next[preset.id] = initialSelection(preset, draft)
                      } else delete next[preset.id]
                    })
                    return next
                  })
                }
              />
              全选
            </label>
            {mode === 'provider-only' && (
              <label className="ml-2 flex shrink-0 cursor-pointer items-center gap-1.5">
                <Checkbox
                  checked={appendTypeSuffix}
                  onCheckedChange={(checked) => setAppendTypeSuffix(checked === true)}
                />
                添加规则类型后缀
              </label>
            )}
            <label className="ml-2 flex shrink-0 cursor-pointer items-center gap-1.5">
              <Checkbox checked={preferGhProxy} onCheckedChange={(checked) => setPreferGhProxy(checked === true)} />
              使用 gh-proxy 加速
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div
              role="status"
              aria-live="polite"
              className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
            >
              <span>
                {catalog.data?.updatedAt ? '已缓存社区目录' : '内置预设'} · {filtered.length} / {presets.length} 项
              </span>
              {catalog.loading ? (
                <span>正在后台更新，可继续选择</span>
              ) : catalog.data?.updatedAt ? (
                <span>
                  上次成功同步{' '}
                  {new Date(catalog.data.updatedAt).toLocaleString('zh-CN', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              ) : null}
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={catalog.reload} disabled={catalog.loading}>
              {catalog.loading ? (
                <LoaderCircle data-icon="inline-start" className="animate-spin" />
              ) : (
                <RefreshCw data-icon="inline-start" />
              )}
              {catalog.loading ? '后台更新中' : '更新社区目录'}
            </Button>
          </div>
          {!catalog.loading && (catalog.error || catalog.data?.stale) && (
            <Alert>
              <AlertTriangle />
              <AlertDescription>
                {catalog.error ||
                  (staleSources.length
                    ? `${staleSources.map((source) => sourceLabels[source]).join('、')} 未能更新。`
                    : '暂未获取到最新的社区目录。')}
                {catalog.data?.updatedAt
                  ? ' 已保留原有目录，可继续选择或重试更新。'
                  : ' 当前显示内置预设，可重试更新。'}
              </AlertDescription>
            </Alert>
          )}

          <div ref={setListElement} className="max-h-[min(56vh,520px)] overflow-y-auto pr-1">
            <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((virtualItem) => {
                const preset = filtered[virtualItem.index]
                const displayPreset = mode === 'provider-only' ? withRuleTypeSuffix(preset, false) : preset
                const effectivePreset = mode === 'provider-only' ? withRuleTypeSuffix(preset, appendTypeSuffix) : preset
                const selection = selections[preset.id]
                const configuredTarget = configuredTargets.get(preset.id)
                const configuredProvider = draft.ruleProviders.some((provider) =>
                  providerMatchesPreset(provider, effectivePreset),
                )
                const disabled = mode === 'provider-only' && appendTypeSuffix && configuredProvider
                return (
                  <div
                    key={virtualItem.key}
                    ref={virtualizer.measureElement}
                    data-index={virtualItem.index}
                    className="absolute top-0 left-0 w-full pb-2"
                    style={{ transform: `translateY(${virtualItem.start}px)` }}
                  >
                    <div
                      className={
                        disabled
                          ? 'rounded-md border bg-muted/50 p-3 text-muted-foreground'
                          : 'rounded-md border bg-card p-3'
                      }
                    >
                      <div className="flex min-h-10 items-center gap-3">
                        <Checkbox
                          id={`preset-${mode}-${preset.id}`}
                          checked={disabled || Boolean(selection)}
                          disabled={disabled}
                          onCheckedChange={(checked) =>
                            setSelections((current) => {
                              if (checked === true) return { ...current, [preset.id]: initialSelection(preset, draft) }
                              const { [preset.id]: _, ...rest } = current
                              return rest
                            })
                          }
                        />
                        <label
                          htmlFor={`preset-${mode}-${preset.id}`}
                          className={`flex min-w-0 flex-1 items-center gap-4 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-center gap-2">
                              <strong className="min-w-0 truncate text-sm">
                                {displayPreset.name}
                                {mode === 'provider-only' && appendTypeSuffix && (
                                  <span className="font-normal text-muted-foreground">
                                    {' '}
                                    {ruleTypeLabels[preset.provider.behavior]}
                                  </span>
                                )}
                              </strong>
                              <Badge variant="outline" className="shrink-0">
                                {categoryLabels[preset.category]}
                              </Badge>
                            </span>
                            <span className="mt-1 block truncate text-xs text-muted-foreground">
                              {sourceLabels[preset.source]} · {preset.description}
                            </span>
                          </span>
                          {(configuredTarget || (mode === 'provider-only' && configuredProvider)) && (
                            <span
                              className="max-w-[42%] shrink-0 truncate text-right text-xs text-muted-foreground"
                              title={`已配置${configuredTarget ? `：${configuredTarget}` : ''}`}
                            >
                              已配置{configuredTarget ? `：${configuredTarget}` : ''}
                            </span>
                          )}
                        </label>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            {!filtered.length && <p className="py-10 text-center text-sm text-muted-foreground">没有匹配的规则集</p>}
          </div>

          <div className="dialog-actions flex-wrap items-center !justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Database className="size-4" />
                已选择 {selectedCount} 项
                {mode === 'provider-and-rule' && selectedCount > 0 && (
                  <>
                    <span>，应用于</span>
                    <Select
                      items={[
                        ...draft.groups
                          .filter((group) => group.name)
                          .map((group) => ({ value: `group:${group.id}`, label: group.name })),
                        { value: 'DIRECT', label: 'DIRECT' },
                        { value: 'REJECT', label: 'REJECT' },
                      ]}
                      value={bulkTargetValue}
                      onValueChange={(value) =>
                        value !== null &&
                        setBulkTarget(
                          value.startsWith('group:')
                            ? { kind: 'group', groupId: value.slice(6) }
                            : { kind: 'builtin', value: value as 'DIRECT' | 'REJECT' },
                        )
                      }
                    >
                      <SelectTrigger className="w-32 shrink-0">
                        <SelectValue placeholder="请选择目标策略" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {draft.groups
                            .filter((group) => group.name)
                            .map((group) => (
                              <SelectItem key={group.id} value={`group:${group.id}`}>
                                {group.name}
                              </SelectItem>
                            ))}
                          <SelectItem value="DIRECT">DIRECT</SelectItem>
                          <SelectItem value="REJECT">REJECT</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <span>规则</span>
                  </>
                )}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button
                type="button"
                disabled={!selectedCount}
                onClick={() => {
                  const selectedPresets = presets.map((preset) => {
                    const effectivePreset =
                      mode === 'provider-only' ? withRuleTypeSuffix(preset, appendTypeSuffix) : preset
                    return preferGhProxy && selections[preset.id]
                      ? {
                          ...effectivePreset,
                          provider: {
                            ...effectivePreset.provider,
                            url: applyGhProxyToGithubUrl(effectivePreset.provider.url),
                          },
                        }
                      : effectivePreset
                  })
                  onApply(
                    Object.values(selections).map((selection) => ({
                      ...selection,
                      forceCreateProvider: mode === 'provider-only' && !appendTypeSuffix,
                      target: bulkTarget,
                    })),
                    selectedPresets,
                  )
                  setOpen(false)
                }}
              >
                <Plus data-icon="inline-start" />
                添加
              </Button>
            </div>
          </div>
        </AppDialog>
      )}
    </>
  )
}
