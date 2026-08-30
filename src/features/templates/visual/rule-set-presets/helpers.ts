import type { RuleDraft, StructuredRuleProviderDraft } from '../model'
import type { RuleSetPreset } from './types'

export function createProviderFromPreset(preset: RuleSetPreset, id: string): StructuredRuleProviderDraft {
  return {
    kind: 'structured',
    id,
    ...preset.provider,
    extras: {},
  }
}

export function insertRulesBeforeMatch(rules: RuleDraft[], newRules: RuleDraft[]) {
  const index = rules.findIndex((rule) => rule.kind === 'structured' && rule.type === 'MATCH')
  if (index < 0) return [...rules, ...newRules]
  return [...rules.slice(0, index), ...newRules, ...rules.slice(index)]
}
