import type { ProfileNodeBinding, Source, TemplateSourceSlot } from '@/api/types'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export function SubscriptionSlotBindingEditor({
  slot,
  value,
  sources,
  onChange,
}: {
  slot: TemplateSourceSlot
  value: ProfileNodeBinding
  sources: Source[]
  onChange: (value: ProfileNodeBinding) => void
}) {
  const sourceId = value.mode === 'source' ? value.sourceIds[0] : undefined
  const selected = sources.find(({ id }) => id === sourceId)
  const subscriptions = sources.filter(({ kind }) => kind === 'url')
  const error = !sourceId
    ? '请为此槽位选择一个订阅节点源'
    : !selected
      ? '绑定的节点源不存在，请重新选择'
      : !selected.enabled
        ? '绑定的节点源已停用，请重新选择'
        : selected.kind !== 'url' || !selected.url
          ? '绑定源的订阅 URL 不可用，请重新选择'
          : ''
  return (
    <FieldGroup>
      <Field data-invalid={Boolean(error)}>
        <FieldLabel htmlFor={`subscription-${slot.key}`}>订阅节点源（单选）</FieldLabel>
        <Select
          value={sourceId || null}
          items={subscriptions.map((source) => ({
            value: source.id,
            label: `${source.name} · ${source.enabled && source.url ? '已启用' : '不可用'}`,
          }))}
          onValueChange={(id) =>
            onChange({ mode: 'source', sourceIds: id ? [id] : [], includeRegex: null, excludeRegex: null })
          }
        >
          <SelectTrigger id={`subscription-${slot.key}`} aria-invalid={Boolean(error)} className="w-full">
            <SelectValue placeholder="选择一个订阅节点源" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {subscriptions.map((source) => (
                <SelectItem key={source.id} value={source.id} disabled={!source.enabled || !source.url}>
                  {source.name} · {source.enabled && source.url ? '已启用' : '不可用'}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {error && <FieldError>{error}</FieldError>}
        {!subscriptions.length && (
          <FieldDescription>暂无订阅节点源，请先到“节点源”页面添加。手动节点源不支持此槽位。</FieldDescription>
        )}
        <FieldDescription>
          不展开本地节点，由 Mihomo 动态加载；更新间隔、User-Agent 和名称排除过滤沿用节点源设置。
        </FieldDescription>
      </Field>
      <FieldDescription>
        原始订阅必须兼容 Mihomo provider，不自动转换格式。最终 YAML
        含订阅地址及可能的密钥，请勿公开分享；本地别名与单节点停用不会同步。
      </FieldDescription>
    </FieldGroup>
  )
}
