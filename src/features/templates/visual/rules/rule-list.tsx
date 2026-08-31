import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import { DragDropProvider } from '@dnd-kit/react'
import { isSortableOperation } from '@dnd-kit/react/sortable'
import {
  type ProxyGroupDraft,
  type RuleDraft,
  type RuleProviderDraft,
  type VisualChangeMeta,
  type VisualIssue,
} from '../model'
import { RuleCard } from './rule-card'
import type { GeoProvider } from './geo-catalog'

const EMPTY_ISSUES: VisualIssue[] = []

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
  onChange: (rules: RuleDraft[], meta?: VisualChangeMeta) => void
  geoProvider?: GeoProvider | ((type: 'GEOSITE' | 'GEOIP') => GeoProvider)
}) {
  const rulesRef = useRef(rules)
  const onChangeRef = useRef(onChange)
  useLayoutEffect(() => {
    rulesRef.current = rules
    onChangeRef.current = onChange
  }, [rules, onChange])

  const issuesByRuleId = useMemo(() => {
    const map = new Map<string, VisualIssue[]>()
    for (const issue of issues) {
      if (!issue.ruleId) continue
      const current = map.get(issue.ruleId)
      if (current) current.push(issue)
      else map.set(issue.ruleId, [issue])
    }
    return map
  }, [issues])

  const handleSave = useCallback((id: string, next: RuleDraft) => {
    onChangeRef.current(rulesRef.current.map((rule) => (rule.id === id ? next : rule)))
  }, [])

  const handleDelete = useCallback((id: string) => {
    onChangeRef.current(rulesRef.current.filter((rule) => rule.id !== id))
  }, [])

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
        onChange(next, { type: 'reorder', scope: 'rules' })
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
            issues={issuesByRuleId.get(rule.id) ?? EMPTY_ISSUES}
            geoProvider={
              typeof geoProvider === 'function' &&
              rule.kind === 'structured' &&
              (rule.type === 'GEOSITE' || rule.type === 'GEOIP')
                ? geoProvider(rule.type)
                : typeof geoProvider === 'string'
                  ? geoProvider
                  : 'metacubex'
            }
            onSave={handleSave}
            onDelete={handleDelete}
          />
        ))}
      </div>
    </DragDropProvider>
  )
}
