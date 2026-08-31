import type { RuleDraft, RuleSetRuleDraft, VisualTemplateDraft } from '../model'
import { canUseNoResolve, resolvePresetNoResolve } from '../validation'
import { createProviderFromPreset, insertRulesBeforeMatch } from './helpers'
import type { ApplyRuleSetPresetOptions, RuleSetPreset, RuleSetPresetMode } from './types'

export function providerMatchesPreset(provider: VisualTemplateDraft['ruleProviders'][number], preset: RuleSetPreset) {
  return (
    provider.kind === 'structured' &&
    provider.name === preset.provider.name &&
    provider.type === preset.provider.type &&
    provider.behavior === preset.provider.behavior &&
    provider.url?.replace('https://gh-proxy.com/', '') === preset.provider.url.replace('https://gh-proxy.com/', '')
  )
}

function sameRule(left: RuleDraft, right: RuleDraft) {
  return (
    left.kind === 'structured' &&
    right.kind === 'structured' &&
    left.type === 'RULE-SET' &&
    right.type === 'RULE-SET' &&
    left.provider.kind === 'provider' &&
    right.provider.kind === 'provider' &&
    left.provider.providerId === right.provider.providerId &&
    left.noResolve === right.noResolve &&
    JSON.stringify(left.target) === JSON.stringify(right.target)
  )
}

export function applyRuleSetPresets(
  draft: VisualTemplateDraft,
  presets: RuleSetPreset[],
  selections: ApplyRuleSetPresetOptions[],
  mode: RuleSetPresetMode,
): VisualTemplateDraft {
  let ruleProviders = [...draft.ruleProviders]
  const resolvedProviders = new Map<string, (typeof ruleProviders)[number]>()

  for (const selection of selections) {
    const preset = presets.find((item) => item.id === selection.presetId)
    if (!preset) continue
    const provider =
      ruleProviders.find((item) => providerMatchesPreset(item, preset)) ||
      createProviderFromPreset(preset, selection.providerId)
    if (!ruleProviders.includes(provider)) ruleProviders.push(provider)
    resolvedProviders.set(selection.presetId, provider)
  }

  if (mode === 'provider-only') return { ...draft, ruleProviders }

  const additions: RuleDraft[] = []
  for (const selection of selections) {
    const preset = presets.find((item) => item.id === selection.presetId)
    if (!preset || !selection.target) continue
    const provider = resolvedProviders.get(selection.presetId)
    if (!provider) continue
    const rule: RuleSetRuleDraft = {
      kind: 'structured',
      id: selection.ruleId,
      type: 'RULE-SET',
      provider: { kind: 'provider', providerId: provider.id },
      target: selection.target,
      noResolve: resolvePresetNoResolve(provider, selection.noResolve ?? preset.noResolve ?? false),
    }
    const planned = canUseNoResolve(rule, { ruleProviders }) ? rule : { ...rule, noResolve: false }
    if (
      !draft.rules.some((existing) => sameRule(existing, planned)) &&
      !additions.some((existing) => sameRule(existing, planned))
    )
      additions.push(planned)
  }

  return { ...draft, ruleProviders, rules: insertRulesBeforeMatch(draft.rules, additions) }
}
