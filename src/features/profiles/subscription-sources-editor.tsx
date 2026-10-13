import { useMemo } from 'react'
import type { Source } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { cn } from '@/lib/utils'
import { SelectionActionButton } from './selection-action-button'

export function SubscriptionSourcesEditor({
  sourceIds,
  sources,
  onChange,
}: {
  sourceIds: string[]
  sources: Source[]
  onChange: (sourceIds: string[]) => void
}) {
  const subscriptions = sources.filter(({ kind }) => kind === 'url')
  const available = subscriptions.filter(({ enabled, url }) => enabled && url)
  const unavailable = sourceIds.some((id) => !available.some((source) => source.id === id))

  const totalNodesInSelectedSubscriptions = useMemo(() => {
    const selectedSet = new Set(sourceIds)
    return subscriptions.filter((s) => selectedSet.has(s.id)).reduce((sum, s) => sum + (s.nodeCount || 0), 0)
  }, [sourceIds, subscriptions])

  return (
    <div className="slot-workspace">
      <div className="slot-source-form">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 min-h-8">
            <div className="flex items-center gap-2 flex-wrap">
              <FieldLabel className="mb-0 text-sm font-medium">选择接入订阅源</FieldLabel>
              <Badge variant="secondary" className="text-xs font-normal text-muted-foreground">
                已选 {sourceIds.length} / {subscriptions.length} 个源
                {sourceIds.length > 0 ? `，共 ${totalNodesInSelectedSubscriptions} 个节点` : ''}
              </Badge>
            </div>

            <div className="flex items-center gap-1.5">
              <SelectionActionButton
                count={sourceIds.length}
                disabled={!available.length}
                onSelectAll={() => onChange(available.slice(0, 20).map(({ id }) => id))}
                onClear={() => onChange([])}
              />
            </div>
          </div>

          <div className="source-picker-grid">
            {subscriptions.map((source) => {
              const checked = sourceIds.includes(source.id)
              const invalid = !source.enabled || !source.url
              return (
                <label
                  key={source.id}
                  htmlFor={`subscription-source-${source.id}`}
                  className={cn(
                    'source-picker-item',
                    checked && 'source-picker-item-selected',
                    invalid && !checked && 'source-picker-item-disabled',
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Checkbox
                      id={`subscription-source-${source.id}`}
                      checked={checked}
                      disabled={invalid && !checked}
                      aria-invalid={checked && invalid}
                      onCheckedChange={(next) =>
                        onChange(next ? [...sourceIds, source.id] : sourceIds.filter((id) => id !== source.id))
                      }
                      className="size-4"
                    />
                    <div className="flex flex-col min-w-0">
                      <span className="font-medium text-xs truncate" title={source.name}>
                        {source.name}
                      </span>
                      {invalid && (
                        <span className="text-[11px] text-destructive">
                          {!source.enabled ? '已停用' : '缺少订阅 URL'}
                        </span>
                      )}
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
        </div>

        {!subscriptions.length && <FieldDescription>暂无订阅源，请先在「节点源」页面添加订阅链接。</FieldDescription>}
        {unavailable && <FieldError>已选订阅源不存在、已停用或缺少 URL，请取消选择或清空后重新选择。</FieldError>}
      </div>
    </div>
  )
}
