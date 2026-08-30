import type { RuleProviderDraft, VisualIssue, VisualTemplateDraft } from '../model'
import { ruleProviderReferences } from '../validation'
import { ProviderCard } from './provider-card'

export function ProviderList({
  draft,
  issues,
  onChange,
  onDelete,
}: {
  draft: VisualTemplateDraft
  issues: VisualIssue[]
  onChange: (providers: RuleProviderDraft[]) => void
  onDelete: (provider: RuleProviderDraft) => void
}) {
  return (
    <div className="template-visual-list">
      {draft.ruleProviders.map((provider) => (
        <ProviderCard
          key={provider.id}
          provider={provider}
          providers={draft.ruleProviders}
          groups={draft.groups}
          references={ruleProviderReferences(draft, provider.id).length}
          issues={issues.filter((issue) => issue.providerId === provider.id)}
          onSave={(next) => onChange(draft.ruleProviders.map((item) => (item.id === provider.id ? next : item)))}
          onDelete={() => onDelete(provider)}
        />
      ))}
    </div>
  )
}
