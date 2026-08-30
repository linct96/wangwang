import type { RuleTargetDraft } from '../model'

export type RuleSetPresetSource = 'metacubex' | 'loyalsoldier'

export type RuleSetPresetCategory = 'common' | 'ai' | 'social' | 'media' | 'ads' | 'china' | 'development' | 'service'

export interface RuleSetPreset {
  id: string
  name: string
  description?: string
  source: RuleSetPresetSource
  category: RuleSetPresetCategory
  provider: {
    name: string
    type: 'http'
    behavior: 'domain' | 'ipcidr' | 'classical'
    format?: 'mrs' | 'yaml' | 'text'
    url: string
    path?: string
    interval?: number
  }
  defaultTarget?: string
  noResolve?: boolean
  keywords?: string[]
}

export type RuleSetPresetMode = 'provider-only' | 'provider-and-rule'

export interface ApplyRuleSetPresetOptions {
  presetId: string
  providerId: string
  ruleId: string
  target?: RuleTargetDraft
  providerConflict: 'keep' | 'replace'
  ruleConflict: 'keep' | 'replace'
  noResolve?: boolean
}
