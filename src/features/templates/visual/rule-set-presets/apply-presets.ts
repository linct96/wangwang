import type { RuleDraft, RuleSetRuleDraft, VisualTemplateDraft } from '../model'
import { canUseNoResolve } from '../validation'
import {
  createProviderFromPreset,
  findPresetProvider,
  findProviderRule,
  insertRulesBeforeMatch,
  providerMatchesPreset,
  targetsEqual,
} from './helpers'
import type { ApplyRuleSetPresetOptions, RuleSetPreset, RuleSetPresetMode } from './types'

export function applyRuleSetPresets(
  draft: VisualTemplateDraft,
  presets: RuleSetPreset[],
  selections: ApplyRuleSetPresetOptions[],
  mode: RuleSetPresetMode,
): VisualTemplateDraft {
  let ruleProviders = [...draft.ruleProviders]

  for (const selection of selections) {
    const preset = presets.find((item) => item.id === selection.presetId)
    if (!preset) continue
    const existing = findPresetProvider(ruleProviders, preset)
    if (!existing) {
      ruleProviders.push(createProviderFromPreset(preset, selection.providerId))
    } else if (!providerMatchesPreset(existing, preset) && selection.providerConflict === 'replace') {
      const replacement = { ...createProviderFromPreset(preset, selection.providerId), id: existing.id }
      ruleProviders = ruleProviders.map((provider) => (provider.id === existing.id ? replacement : provider))
    }
  }

  if (mode === 'provider-only') return { ...draft, ruleProviders }

  let rules = [...draft.rules]
  const additions: RuleDraft[] = []
  for (const selection of selections) {
    const preset = presets.find((item) => item.id === selection.presetId)
    if (!preset || !selection.target) continue
    const provider = findPresetProvider(ruleProviders, preset)
    if (!provider) continue
    const existingRule = findProviderRule(rules, provider.id)
    if (existingRule?.kind === 'structured' && existingRule.type === 'RULE-SET') {
      if (!targetsEqual(existingRule.target, selection.target) && selection.ruleConflict === 'replace') {
        const next = { ...existingRule, target: selection.target, noResolve: selection.noResolve ?? false }
        const valid = canUseNoResolve(next, { ruleProviders }) ? next : { ...next, noResolve: false }
        rules = rules.map((rule) => (rule.id === existingRule.id ? valid : rule))
      }
      continue
    }
    const rule: RuleSetRuleDraft = {
      kind: 'structured',
      id: selection.ruleId,
      type: 'RULE-SET',
      provider: { kind: 'provider', providerId: provider.id },
      target: selection.target,
      noResolve: selection.noResolve ?? preset.noResolve ?? false,
    }
    additions.push(canUseNoResolve(rule, { ruleProviders }) ? rule : { ...rule, noResolve: false })
  }

  return { ...draft, ruleProviders, rules: insertRulesBeforeMatch(rules, additions) }
}
