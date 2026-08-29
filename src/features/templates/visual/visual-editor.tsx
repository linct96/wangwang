import { useState, useMemo } from 'react'
import { AlertTriangle, Plus, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { groupReferences } from './validation'
import { findPotentialRawReferences, renameRawReferences } from './yaml-adapter'
import { GroupList } from './groups/group-list'
import { RuleList } from './rules/rule-list'
import { GroupDialog } from './groups/group-dialog'
import { RuleDialog } from './rules/rule-dialog'
import {
  targetLabel,
  type ProxyGroupDraft,
  type StructuredRuleDraft,
  type VisualIssue,
  type VisualTemplateDraft,
} from './model'

export function VisualTemplateEditor({
  draft,
  issues,
  onChange,
}: {
  draft: VisualTemplateDraft
  issues: VisualIssue[]
  onChange: (draft: VisualTemplateDraft) => void
}) {
  const [ruleQuery, setRuleQuery] = useState('')
  const blocking = issues.filter((issue) => issue.level === 'error')
  const update = (next: VisualTemplateDraft) => onChange(next)

  const firstMatchIndex = draft.rules.findIndex((r) => r.kind === 'structured' && r.type === 'MATCH')
  const hasMatchNotLast = firstMatchIndex !== -1 && firstMatchIndex !== draft.rules.length - 1

  function fixMatchOrder() {
    const nonMatchRules = draft.rules.filter((r) => !(r.kind === 'structured' && r.type === 'MATCH'))
    const matchRules = draft.rules.filter((r) => r.kind === 'structured' && r.type === 'MATCH')
    update({ ...draft, rules: [...nonMatchRules, ...matchRules] })
    toast.success('已将 MATCH 兜底规则移至最末尾')
  }

  function addRule(rule: StructuredRuleDraft) {
    if (firstMatchIndex !== -1 && rule.type !== 'MATCH') {
      const nextRules = [...draft.rules]
      nextRules.splice(firstMatchIndex, 0, rule)
      update({ ...draft, rules: nextRules })
    } else {
      update({ ...draft, rules: [...draft.rules, rule] })
    }
  }

  const filteredRulesWithIndex = useMemo(() => {
    const query = ruleQuery.trim().toLowerCase()
    return draft.rules
      .map((rule, originalIndex) => ({ rule, originalIndex }))
      .filter(({ rule }) => {
        if (!query) return true
        if (rule.kind === 'raw') return rule.raw.toLowerCase().includes(query)
        const typeMatch = rule.type.toLowerCase().includes(query)
        const valMatch = (rule.value || '').toLowerCase().includes(query)
        const targetText = targetLabel(rule.target, draft.groups).toLowerCase()
        const targetMatch = targetText.includes(query)
        return typeMatch || valMatch || targetMatch
      })
  }, [draft.rules, draft.groups, ruleQuery])

  function removeGroup(group: ProxyGroupDraft) {
    const refs = groupReferences(draft, group.id)
    const raw = findPotentialRawReferences(draft, group.name)
    if (refs.groups.length || refs.rules.length || raw.count) {
      toast.error(
        `该代理组被 ${refs.groups.length} 个代理组和 ${refs.rules.length} 条规则引用${raw.count ? '，或被高级配置引用' : ''}`,
      )
      return
    }
    update({
      ...draft,
      groups: draft.groups.filter((item) => item.id !== group.id),
    })
  }

  function updateGroups(groups: ProxyGroupDraft[]) {
    const changed = groups.find((next) => {
      const previous = draft.groups.find((item) => item.id === next.id)
      return previous && previous.name !== next.name
    })
    if (!changed) {
      update({ ...draft, groups })
      return
    }
    const previous = draft.groups.find((item) => item.id === changed.id)!
    update(renameRawReferences({ ...draft, groups }, previous.name, changed.name))
  }
  return (
    <div className="template-visual-editor">
      {issues.length > 0 && (
        <Alert
          variant={blocking.length ? 'destructive' : 'default'}
          className={cn(
            'template-visual-issues',
            blocking.length
              ? 'border-destructive/60 bg-destructive/10'
              : 'border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-100',
          )}
        >
          <AlertDescription>
            {issues
              .filter((issue) => issue.level === 'warning')
              .map((issue) => issue.message)
              .join('；')}
          </AlertDescription>
        </Alert>
      )}
      <section className="template-visual-section">
        <header className="template-visual-toolbar">
          <h2>代理组</h2>
          <GroupDialog groups={draft.groups} onSave={(group) => update({ ...draft, groups: [...draft.groups, group] })}>
            <Button type="button" size="default">
              <Plus data-icon="inline-start" />
              添加代理组
            </Button>
          </GroupDialog>
        </header>
        <GroupList groups={draft.groups} onChange={updateGroups} onDelete={removeGroup} />
      </section>
      <section className="template-visual-section">
        <header className="template-visual-toolbar">
          <div className="template-rule-header-left">
            <h2>规则</h2>
            <span className="template-section-count">
              {ruleQuery ? `${filteredRulesWithIndex.length} / ${draft.rules.length}` : draft.rules.length}
            </span>
            {hasMatchNotLast && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="template-fix-match-btn"
                onClick={fixMatchOrder}
              >
                <AlertTriangle className="size-3.5 mr-1 text-amber-500" />
                将 MATCH 置底
              </Button>
            )}
          </div>
          <div className="template-rule-header-right">
            {draft.rules.length >= 4 && (
              <div className="template-rule-search-box">
                <Search className="template-rule-search-icon" />
                <Input
                  placeholder="搜索规则 (类型/域名/目标)..."
                  value={ruleQuery}
                  onChange={(e) => setRuleQuery(e.target.value)}
                  className="template-rule-search-input"
                />
                {ruleQuery && (
                  <button
                    type="button"
                    onClick={() => setRuleQuery('')}
                    className="template-rule-search-clear"
                    title="清除搜索"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            )}
            <RuleDialog groups={draft.groups} rules={draft.rules} onSave={(rule) => addRule(rule)}>
              <Button type="button" size="default">
                <Plus data-icon="inline-start" />
                添加规则
              </Button>
            </RuleDialog>
          </div>
        </header>
        <RuleList
          rules={draft.rules}
          groups={draft.groups}
          issues={issues}
          query={ruleQuery}
          onChange={(rules) => update({ ...draft, rules })}
        />
      </section>
    </div>
  )
}
