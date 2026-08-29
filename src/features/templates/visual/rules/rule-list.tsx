import { DragDropProvider } from '@dnd-kit/react'
import { targetLabel, type ProxyGroupDraft, type RuleDraft, type VisualIssue } from '../model'
import { RuleCard } from './rule-card'

export function RuleList({
  rules,
  groups,
  issues,
  query,
  onChange,
}: {
  rules: RuleDraft[]
  groups: ProxyGroupDraft[]
  issues: VisualIssue[]
  query: string
  onChange: (rules: RuleDraft[]) => void
}) {
  const firstMatch = rules.findIndex((rule) => rule.kind === 'structured' && rule.type === 'MATCH')
  const filtered = rules
    .map((rule, originalIndex) => ({ rule, originalIndex }))
    .filter(({ rule }) => {
      if (!query) return true
      const target = rule.kind === 'structured' ? targetLabel(rule.target, groups) : ''
      return (rule.kind === 'raw' ? rule.raw : `${rule.type} ${rule.value || ''} ${target}`)
        .toLowerCase()
        .includes(query.toLowerCase())
    })

  return (
    <DragDropProvider
      onDragEnd={(event) => {
        const { source, target } = event.operation
        if (!source || !target || source.id === target.id) return
        const from = rules.findIndex((rule) => rule.id === source.id)
        const to = rules.findIndex((rule) => rule.id === target.id)
        if (from < 0 || to < 0) return
        const next = [...rules]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        onChange(next)
      }}
    >
      <div className="template-visual-list">
        {filtered.map(({ rule, originalIndex }) => (
          <RuleCard
            key={rule.id}
            index={originalIndex}
            rule={rule}
            groups={groups}
            isAfterMatch={firstMatch !== -1 && originalIndex > firstMatch}
            issues={issues.filter((issue) => issue.ruleId === rule.id)}
            onSave={(next) => onChange(rules.map((item) => (item.id === rule.id ? next : item)))}
            onDelete={() => onChange(rules.filter((item) => item.id !== rule.id))}
          />
        ))}
      </div>
    </DragDropProvider>
  )
}
