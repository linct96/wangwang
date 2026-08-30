import type { RuleDraft, RuleSetRuleDraft, VisualTemplateDraft } from '../model'
import { canUseNoResolve, resolvePresetNoResolve } from '../validation'
import {
  createProviderFromPreset,
  findPresetProvider,
  findProviderRule,
  insertRulesBeforeMatch,
  providerMatchesPreset,
  ruleMatchesSelection,
} from './helpers'
import type { ApplyRuleSetPresetOptions, RuleSetPreset, RuleSetPresetMode } from './types'

export function applyRuleSetPresets(
  draft: VisualTemplateDraft,
  presets: RuleSetPreset[],
  selections: ApplyRuleSetPresetOptions[],
  mode: RuleSetPresetMode,
): VisualTemplateDraft {
  let ruleProviders = [...draft.ruleProviders]
  const resolvedProviders = new Map<string, (typeof ruleProviders)[number]>()
  const usedNames = new Set(ruleProviders.map((provider) => provider.name))

  for (const selection of selections) {
    const preset = presets.find((item) => item.id === selection.presetId)
    if (!preset) continue
    // 冲突只针对批处理前的草稿；本批次新建的 Provider 由 presetId 映射识别。
    const existing = findPresetProvider(draft.ruleProviders, preset)
    let resolved = existing
    if (!existing) {
      let name = preset.provider.name
      if (usedNames.has(name)) {
        const base = `${name}-${preset.source}`
        name = base
        for (let index = 2; usedNames.has(name); index += 1) name = `${base}-${index}`
      }
      resolved = createProviderFromPreset({ ...preset, provider: { ...preset.provider, name } }, selection.providerId)
      ruleProviders.push(resolved)
      usedNames.add(name)
    } else if (!providerMatchesPreset(existing, preset) && selection.providerConflict === 'replace') {
      resolved = { ...createProviderFromPreset(preset, selection.providerId), id: existing.id }
      ruleProviders = ruleProviders.map((provider) => (provider.id === existing.id ? resolved! : provider))
    }
    if (resolved) resolvedProviders.set(selection.presetId, resolved)
  }

  if (mode === 'provider-only') return { ...draft, ruleProviders }

  let rules = [...draft.rules]
  const plannedRules = [...draft.rules]
  const additions: RuleDraft[] = []
  for (const selection of selections) {
    const preset = presets.find((item) => item.id === selection.presetId)
    if (!preset || !selection.target) continue
    const provider = resolvedProviders.get(selection.presetId)
    if (!provider) continue
    const existingRule = findProviderRule(plannedRules, provider.id)
    if (existingRule?.kind === 'structured' && existingRule.type === 'RULE-SET') {
      const noResolve = resolvePresetNoResolve(provider, selection.noResolve ?? preset.noResolve ?? false)
      if (
        !ruleMatchesSelection(existingRule, provider.id, selection.target, noResolve) &&
        selection.ruleConflict === 'replace'
      ) {
        const next = { ...existingRule, target: selection.target, noResolve }
        const valid = canUseNoResolve(next, { ruleProviders }) ? next : { ...next, noResolve: false }
        rules = rules.map((rule) => (rule.id === existingRule.id ? valid : rule))
        const plannedIndex = plannedRules.findIndex((rule) => rule.id === existingRule.id)
        if (plannedIndex >= 0) plannedRules[plannedIndex] = valid
        const additionIndex = additions.findIndex((rule) => rule.id === existingRule.id)
        if (additionIndex >= 0) additions[additionIndex] = valid
      }
      continue
    }
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
    plannedRules.push(planned)
  }

  return { ...draft, ruleProviders, rules: insertRulesBeforeMatch(rules, additions) }
}
