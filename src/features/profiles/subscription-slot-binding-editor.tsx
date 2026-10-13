import { useState } from 'react'
import type { ProfileNodeBinding, Source, TemplateSourceSlot } from '@/api/types'
import { Field, FieldDescription, FieldError, FieldGroup } from '@/components/ui/field'
import { SubscriptionSourcesEditor } from './subscription-sources-editor'

export function SubscriptionSlotBindingEditor({
  slot,
  value,
  sources,
  showValidation = false,
  onChange,
}: {
  slot: TemplateSourceSlot
  value: ProfileNodeBinding
  sources: Source[]
  showValidation?: boolean
  onChange: (value: ProfileNodeBinding) => void
}) {
  const [touched, setTouched] = useState(false)
  const sourceId = value.mode === 'source' ? value.sourceIds[0] : undefined
  const selected = sources.find(({ id }) => id === sourceId)
  const subscriptions = sources.filter(({ kind }) => kind === 'url')
  const error = !sourceId
    ? touched || showValidation
      ? '请为此槽位选择一个订阅节点源'
      : ''
    : !selected
      ? '绑定的节点源不存在，请重新选择'
      : !selected.enabled
        ? '绑定的节点源已停用，请重新选择'
        : selected.kind !== 'url' || !selected.url
          ? '绑定源的订阅 URL 不可用，请重新选择'
          : ''
  return (
    <FieldGroup>
      <Field data-invalid={Boolean(error)} aria-label={slot.name}>
        <SubscriptionSourcesEditor
          single
          idPrefix={`subscription-${slot.key}`}
          invalid={Boolean(error)}
          sourceIds={sourceId ? [sourceId] : []}
          sources={sources}
          onChange={(sourceIds) => {
            setTouched(true)
            onChange({ mode: 'source', sourceIds, includeRegex: null, excludeRegex: null })
          }}
        />
        {error && <FieldError>{error}</FieldError>}
        {!subscriptions.length && (
          <FieldDescription>暂无订阅节点源，请先到“节点源”页面添加。手动节点源不支持此槽位。</FieldDescription>
        )}
        <FieldDescription>
          不展开本地节点，由 Mihomo 动态加载；更新间隔、User-Agent 和名称排除过滤沿用节点源设置。
        </FieldDescription>
      </Field>
    </FieldGroup>
  )
}
