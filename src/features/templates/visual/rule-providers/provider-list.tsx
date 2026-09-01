import { DragDropProvider } from '@dnd-kit/react'
import { isSortableOperation } from '@dnd-kit/react/sortable'
import type { RuleProviderDraft, VisualChangeMeta, VisualIssue, VisualTemplateDraft } from '../model'
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
  onChange: (providers: RuleProviderDraft[], meta?: VisualChangeMeta) => void
  onDelete: (provider: RuleProviderDraft) => void
}) {
  return (
    <DragDropProvider
      onDragEnd={(event) => {
        if (event.canceled || !isSortableOperation(event.operation) || !event.operation.source) return
        const { source } = event.operation
        const from = source.initialIndex
        const to = source.index
        if (from === to || from < 0 || from >= draft.ruleProviders.length || to < 0 || to >= draft.ruleProviders.length)
          return
        const next = [...draft.ruleProviders]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        onChange(next, { type: 'reorder', scope: 'ruleProviders' })
      }}
    >
      <div className="template-visual-list">
        {draft.ruleProviders.map((provider, index) => (
          <ProviderCard
            key={provider.id}
            index={index}
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
    </DragDropProvider>
  )
}
