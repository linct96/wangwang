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

export interface RuleSetPresetCatalogResponse {
  items: RuleSetPreset[]
  updatedAt: string | null
  revision: string | null
  stale: boolean
  sources?: {
    metacubex: { items: RuleSetPreset[]; updatedAt: string; revision: string; stale?: boolean }
    loyalsoldier: { items: RuleSetPreset[]; updatedAt: string; revision: string; stale?: boolean }
  }
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
