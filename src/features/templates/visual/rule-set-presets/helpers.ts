import type { RuleDraft, RuleProviderDraft, RuleTargetDraft, StructuredRuleProviderDraft } from '../model'
import type { RuleSetPreset } from './types'

export function createProviderFromPreset(preset: RuleSetPreset, id: string): StructuredRuleProviderDraft {
  return {
    kind: 'structured',
    id,
    ...preset.provider,
    extras: {},
  }
}

export function findPresetProvider(providers: RuleProviderDraft[], preset: RuleSetPreset) {
  return providers.find((provider) => provider.name === preset.provider.name)
}

export function providerMatchesPreset(provider: RuleProviderDraft, preset: RuleSetPreset) {
  if (provider.kind !== 'structured') return false
  const expected = preset.provider
  return (
    provider.type === expected.type &&
    provider.behavior === expected.behavior &&
    provider.format === expected.format &&
    provider.url === expected.url &&
    provider.path === expected.path &&
    provider.interval === expected.interval &&
    provider.proxy === undefined &&
    provider.pathInBundle === undefined &&
    provider.sizeLimit === undefined &&
    provider.header === undefined &&
    provider.payload === undefined &&
    Object.keys(provider.extras).length === 0
  )
}

export function findProviderRule(rules: RuleDraft[], providerId: string) {
  return rules.find(
    (rule) =>
      rule.kind === 'structured' &&
      rule.type === 'RULE-SET' &&
      rule.provider.kind === 'provider' &&
      rule.provider.providerId === providerId,
  )
}

export function targetsEqual(left: RuleTargetDraft, right: RuleTargetDraft) {
  if (left.kind !== right.kind) return false
  if (left.kind === 'group' && right.kind === 'group') return left.groupId === right.groupId
  if (left.kind === 'builtin' && right.kind === 'builtin') return left.value === right.value
  return left.kind === 'raw' && right.kind === 'raw' && left.value === right.value
}

export function insertRulesBeforeMatch(rules: RuleDraft[], newRules: RuleDraft[]) {
  const index = rules.findIndex((rule) => rule.kind === 'structured' && rule.type === 'MATCH')
  if (index < 0) return [...rules, ...newRules]
  return [...rules.slice(0, index), ...newRules, ...rules.slice(index)]
}
