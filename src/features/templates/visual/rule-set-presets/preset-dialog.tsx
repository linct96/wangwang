import { useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertTriangle, Database, LoaderCircle, Plus, RefreshCw, Search } from 'lucide-react'
import { AppDialog } from '@/components/app-primitives'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { newRule, newRuleProvider } from '../yaml-adapter'
import { targetLabel, type RuleTargetDraft, type VisualTemplateDraft } from '../model'
import { applyGhProxyToGithubUrl } from '../geo/presets'
import { RULE_SET_PRESETS } from './catalog'
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
  const [preferGhProxy, setPreferGhProxy] = useState(true)
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
    const providerNames = new Map(draft.ruleProviders.map((provider) => [provider.id, provider.name]))
    const targets = new Map<string, Set<string>>()
    draft.rules.forEach((rule) => {
      if (rule.kind !== 'structured' || rule.type !== 'RULE-SET' || rule.provider.kind !== 'provider') return
      const providerName = providerNames.get(rule.provider.providerId)
      if (!providerName) return
      const values = targets.get(providerName) || new Set<string>()
      values.add(targetLabel(rule.target, draft.groups))
      targets.set(providerName, values)
    })
    return new Map([...targets].map(([name, values]) => [name, [...values].join('、')]))
  }, [draft.groups, draft.ruleProviders, draft.rules])
  const listRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 86,
    getItemKey: (index) => filtered[index].id,
    overscan: 8,
  })

  function show() {
    setQuery('')
    setSource('all')
    setCategory('all')
    setSelections({})
    setPreferGhProxy(true)
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

          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <label className="flex shrink-0 cursor-pointer items-center gap-1.5">
              <Checkbox
                aria-label="全选"
                checked={someFilteredSelected ? 'indeterminate' : allFilteredSelected}
                onCheckedChange={(checked) =>
                  setSelections((current) => {
                    const next = { ...current }
                    filtered.forEach((preset) => {
                      if (checked === true) {
                        if (
                          mode === 'provider-only' &&
                          draft.ruleProviders.some((provider) => providerMatchesPreset(provider, preset))
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
            <label className="ml-2 flex shrink-0 cursor-pointer items-center gap-1.5">
              <Checkbox checked={preferGhProxy} onCheckedChange={(checked) => setPreferGhProxy(checked === true)} />
              使用 gh-proxy 加速
            </label>
            {(catalog.error || catalog.data?.stale) && <AlertTriangle className="size-3.5 text-amber-500" />}
            {catalog.loading
              ? '正在同步社区目录，内置预设可正常使用'
              : catalog.error
                ? catalog.data
                  ? '社区目录刷新失败，当前使用上次加载的数据'
                  : '社区目录加载失败，当前使用内置预设'
                : catalog.data?.stale
                  ? '社区目录暂时使用上次同步的数据'
                  : null}
            {staleSources.map((source) => (
              <span key={source}>{source === 'metacubex' ? 'MetaCubeX' : 'Loyalsoldier'} 数据暂时使用上次同步结果</span>
            ))}
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {catalog.data?.updatedAt && !catalog.loading && (
                <span>
                  更新于{' '}
                  {new Date(catalog.data.updatedAt).toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2"
                onClick={catalog.reload}
                disabled={catalog.loading}
              >
                {catalog.loading ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                {catalog.loading ? '刷新中' : '刷新'}
              </Button>
            </div>
          </div>

          <div ref={listRef} className="max-h-[min(56vh,520px)] overflow-y-auto pr-1">
            <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((virtualItem) => {
                const preset = filtered[virtualItem.index]
                const selection = selections[preset.id]
                const configuredTarget = configuredTargets.get(preset.provider.name)
                const configuredProvider = draft.ruleProviders.some((provider) =>
                  providerMatchesPreset(provider, preset),
                )
                return (
                  <div
                    key={virtualItem.key}
                    ref={virtualizer.measureElement}
                    data-index={virtualItem.index}
                    className="absolute top-0 left-0 w-full pb-2"
                    style={{ transform: `translateY(${virtualItem.start}px)` }}
                  >
                    <div className="rounded-md border bg-card p-3">
                      <div className="flex min-h-10 items-center gap-3">
                        <Checkbox
                          id={`preset-${mode}-${preset.id}`}
                          checked={Boolean(selection)}
                          disabled={mode === 'provider-only' && configuredProvider}
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
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-4"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-center gap-2">
                              <strong className="min-w-0 truncate text-sm">{preset.name}</strong>
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
                      value={bulkTargetValue}
                      onValueChange={(value) =>
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
                        {draft.groups
                          .filter((group) => group.name)
                          .map((group) => (
                            <SelectItem key={group.id} value={`group:${group.id}`}>
                              {group.name}
                            </SelectItem>
                          ))}
                        <SelectItem value="DIRECT">DIRECT</SelectItem>
                        <SelectItem value="REJECT">REJECT</SelectItem>
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
                  const selectedPresets = presets.map((preset) =>
                    preferGhProxy && selections[preset.id]
                      ? {
                          ...preset,
                          provider: { ...preset.provider, url: applyGhProxyToGithubUrl(preset.provider.url) },
                        }
                      : preset,
                  )
                  onApply(
                    Object.values(selections).map((selection) => ({ ...selection, target: bulkTarget })),
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
