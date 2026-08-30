import { AlertTriangle, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { groupReferences } from './validation'
import { findPotentialRawReferences, renameRawReferences } from './yaml-adapter'
import { GroupList } from './groups/group-list'
import { RuleList } from './rules/rule-list'
import { GroupDialog } from './groups/group-dialog'
import { RuleDialog } from './rules/rule-dialog'
import { type ProxyGroupDraft, type StructuredRuleDraft, type VisualIssue, type VisualTemplateDraft } from './model'
import type { GeoDataset } from './rules/geo-catalog'
import { GeoSettingsPanel } from './geo/geo-settings-panel'

export function VisualTemplateEditor({
  draft,
  issues,
  onChange,
  dataset = 'full',
  customGeo = false,
}: {
  draft: VisualTemplateDraft
  issues: VisualIssue[]
  onChange: (draft: VisualTemplateDraft) => void
  dataset?: GeoDataset | ((type: 'GEOSITE' | 'GEOIP') => GeoDataset)
  customGeo?: boolean
}) {
  const warnings = issues.filter((issue) => issue.level === 'warning')
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
    const renamed = renameRawReferences({ ...draft, groups }, previous.name, changed.name)
    // default-selected 保存的是名称，不是运行时 groupId；组重命名时必须同步它。
    update({
      ...renamed,
      groups: renamed.groups.map((group) =>
        group.kind === 'structured' && group.defaultSelected === previous.name
          ? { ...group, defaultSelected: changed.name }
          : group,
      ),
    })
  }
  return (
    <div className="template-visual-editor">
      {warnings.length > 0 && (
        <Alert
          variant="default"
          className="template-visual-issues border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-100"
        >
          <AlertDescription>{warnings.map((issue) => issue.message).join('；')}</AlertDescription>
        </Alert>
      )}
      <GeoSettingsPanel value={draft.geo} issues={issues} onChange={(geo) => update({ ...draft, geo })} />
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
        {customGeo && (
          <Alert className="mx-4 mt-4">
            <AlertDescription>当前使用自定义 GEO 数据源，建议列表可能与实际数据库不同</AlertDescription>
          </Alert>
        )}
        <header className="template-visual-toolbar">
          <div className="template-rule-header-left">
            <h2>规则</h2>
            <span className="template-section-count">{draft.rules.length}</span>
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
            <RuleDialog groups={draft.groups} rules={draft.rules} dataset={dataset} onSave={(rule) => addRule(rule)}>
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
          onChange={(rules) => update({ ...draft, rules })}
          dataset={dataset}
        />
      </section>
    </div>
  )
}
