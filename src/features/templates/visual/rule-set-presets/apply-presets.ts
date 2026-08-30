import type { RuleDraft, RuleSetRuleDraft, VisualTemplateDraft } from '../model'
import { canUseNoResolve, resolvePresetNoResolve } from '../validation'
import { createProviderFromPreset, insertRulesBeforeMatch } from './helpers'
import type { ApplyRuleSetPresetOptions, RuleSetPreset, RuleSetPresetMode } from './types'

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
    const provider = createProviderFromPreset(preset, selection.providerId)
    ruleProviders.push(provider)
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
    additions.push(planned)
  }

  return { ...draft, ruleProviders, rules: insertRulesBeforeMatch(draft.rules, additions) }
}
