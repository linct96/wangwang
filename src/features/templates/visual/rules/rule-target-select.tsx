import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ProxyGroupDraft, RuleTargetDraft } from '../model'

export function RuleTargetSelect({
  groups,
  value,
  onChange,
  className,
}: {
  groups: ProxyGroupDraft[]
  value: RuleTargetDraft
  onChange: (value: RuleTargetDraft) => void
  className?: string
}) {
  const selected =
    value.kind === 'group' ? `group:${value.groupId}` : value.kind === 'builtin' ? value.value : `raw:${value.value}`

  return (
    <Select
      value={selected}
      onValueChange={(next) =>
        onChange(
          next.startsWith('group:')
            ? { kind: 'group', groupId: next.slice(6) }
            : next === 'DIRECT' || next === 'REJECT'
              ? { kind: 'builtin', value: next }
              : { kind: 'raw', value: next.slice(4) },
        )
      }
    >
      <SelectTrigger className={className}>
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
          {value.kind === 'raw' && <SelectItem value={`raw:${value.value}`}>{value.value}（高级）</SelectItem>}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
