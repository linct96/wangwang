import { DragDropProvider } from '@dnd-kit/react'
import { isSortableOperation } from '@dnd-kit/react/sortable'
import { type ProxyGroupDraft, type RuleDraft, type RuleProviderDraft, type VisualIssue } from '../model'
import { RuleCard } from './rule-card'
import type { GeoProvider } from './geo-catalog'

export function RuleList({
  rules,
  groups,
  ruleProviders,
  issues,
  onChange,
  geoProvider = 'metacubex',
}: {
  rules: RuleDraft[]
  groups: ProxyGroupDraft[]
  ruleProviders: RuleProviderDraft[]
  issues: VisualIssue[]
  onChange: (rules: RuleDraft[]) => void
  geoProvider?: GeoProvider | ((type: 'GEOSITE' | 'GEOIP') => GeoProvider)
}) {
  const firstMatch = rules.findIndex((rule) =>
    rule.kind === 'structured' ? rule.type === 'MATCH' : rule.raw.split(',', 1)[0].trim() === 'MATCH',
  )
  return (
    <DragDropProvider
      onDragEnd={(event) => {
        if (event.canceled || !isSortableOperation(event.operation) || !event.operation.source) return
        const { source } = event.operation
        const from = source.initialIndex
        const to = source.index
        if (from === to || from < 0 || from >= rules.length || to < 0 || to >= rules.length) return
        const next = [...rules]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        onChange(next)
      }}
    >
      <div className="template-visual-list">
        {rules.map((rule, originalIndex) => (
          <RuleCard
            key={rule.id}
            index={originalIndex}
            rule={rule}
            groups={groups}
            ruleProviders={ruleProviders}
            isAfterMatch={firstMatch !== -1 && originalIndex > firstMatch}
            issues={issues.filter((issue) => issue.ruleId === rule.id)}
            geoProvider={
              typeof geoProvider === 'function' &&
              rule.kind === 'structured' &&
              (rule.type === 'GEOSITE' || rule.type === 'GEOIP')
                ? geoProvider(rule.type)
                : typeof geoProvider === 'string'
                  ? geoProvider
                  : 'metacubex'
            }
            onSave={(next) => onChange(rules.map((item) => (item.id === rule.id ? next : item)))}
            onDelete={() => onChange(rules.filter((item) => item.id !== rule.id))}
          />
        ))}
      </div>
    </DragDropProvider>
  )
}
