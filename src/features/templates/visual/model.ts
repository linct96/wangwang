export type VisualTemplateDraft = {
  geo: GeoSettingsDraft
  groups: ProxyGroupDraft[]
  ruleProviders: RuleProviderDraft[]
  rules: RuleDraft[]
}

export type GeoSettingsDraft = {
  geodataMode?: boolean | null
  geoAutoUpdate?: boolean | null
  geoUpdateInterval?: number | null
  geoxUrl: { geoip?: string | null; geosite?: string | null; mmdb?: string | null; asn?: string | null }
}

export type SupportedProxyGroupType = 'select' | 'url-test' | 'fallback' | 'load-balance'
export type SupportedLoadBalanceStrategy = 'consistent-hashing' | 'round-robin' | 'sticky-sessions'

export type ProxyGroupMemberDraft =
  | { kind: 'all-proxies' }
  | { kind: 'group'; groupId: string }
  | { kind: 'builtin'; value: 'DIRECT' | 'REJECT' }
  | { kind: 'raw'; value: string }

export type StructuredProxyGroupDraft = {
  kind: 'structured'
  id: string
  name: string
  type: SupportedProxyGroupType
  members: ProxyGroupMemberDraft[]
  defaultSelected?: string
  filter?: string
  excludeFilter?: string
  url?: string
  interval?: number
  tolerance?: number
  strategy?: SupportedLoadBalanceStrategy
  extras: Record<string, unknown>
}

export type RawProxyGroupDraft = {
  kind: 'raw'
  id: string
  name: string
  type: string
  raw: Record<string, unknown>
}

export type ProxyGroupDraft = StructuredProxyGroupDraft | RawProxyGroupDraft

export type RuleProviderType = 'http' | 'file' | 'inline'
export type RuleProviderBehavior = 'domain' | 'ipcidr' | 'classical'
export type RuleProviderFormat = 'yaml' | 'text' | 'mrs'

export type RuleProviderProxyDraft =
  | { kind: 'group'; groupId: string }
  | { kind: 'builtin'; value: 'DIRECT' }
  | { kind: 'raw'; value: string }

export type StructuredRuleProviderDraft = {
  kind: 'structured'
  id: string
  name: string
  type: RuleProviderType
  behavior: RuleProviderBehavior
  format?: RuleProviderFormat
  url?: string
  path?: string
  interval?: number
  proxy?: RuleProviderProxyDraft
  pathInBundle?: string
  sizeLimit?: number
  header?: Record<string, string[]>
  payload?: string[]
  extras: Record<string, unknown>
}

export type RawRuleProviderDraft = {
  kind: 'raw'
  id: string
  name: string
  reason?: string
  rawYaml: string
}

export type RuleProviderDraft = StructuredRuleProviderDraft | RawRuleProviderDraft

export type SupportedRuleType =
  | 'DOMAIN'
  | 'DOMAIN-SUFFIX'
  | 'DOMAIN-KEYWORD'
  | 'GEOSITE'
  | 'GEOIP'
  | 'IP-CIDR'
  | 'IP-CIDR6'
  | 'RULE-SET'
  | 'MATCH'

export type RuleTargetDraft =
  | { kind: 'group'; groupId: string }
  | { kind: 'builtin'; value: 'DIRECT' | 'REJECT' }
  | { kind: 'raw'; value: string }

export type ValueRuleDraft = {
  kind: 'structured'
  id: string
  type: Exclude<SupportedRuleType, 'RULE-SET' | 'MATCH'>
  value: string
  target: RuleTargetDraft
  noResolve: boolean
}

export type RuleSetRuleDraft = {
  kind: 'structured'
  id: string
  type: 'RULE-SET'
  provider: { kind: 'provider'; providerId: string } | { kind: 'raw'; value: string }
  target: RuleTargetDraft
  noResolve: boolean
}

export type MatchRuleDraft = {
  kind: 'structured'
  id: string
  type: 'MATCH'
  target: RuleTargetDraft
  noResolve: false
}

export type StructuredRuleDraft = ValueRuleDraft | RuleSetRuleDraft | MatchRuleDraft

export type RawRuleDraft = {
  kind: 'raw'
  id: string
  raw: string
}

export type RuleDraft = StructuredRuleDraft | RawRuleDraft

export type VisualIssue = {
  level: 'error' | 'warning'
  code: string
  message: string
  groupId?: string
  providerId?: string
  ruleId?: string
  geoField?: 'geodata-mode' | 'geo-auto-update' | 'geo-update-interval' | 'geoip' | 'geosite' | 'mmdb' | 'asn'
}

export function memberLabel(member: ProxyGroupMemberDraft, groups: ProxyGroupDraft[] = []): string {
  if (member.kind === 'all-proxies') return '自定义节点源'
  if (member.kind === 'builtin' || member.kind === 'raw') return member.value
  return groups.find((group) => group.id === member.groupId)?.name || '未知代理组'
}

export function targetLabel(target: RuleTargetDraft, groups: ProxyGroupDraft[] = []): string {
  if (target.kind === 'builtin' || target.kind === 'raw') {
    return target.value
  }
  return groups.find((group) => group.id === target.groupId)?.name || '未知代理组'
}

export function ruleProviderLabel(provider: RuleProviderDraft, includeFormat = true) {
  if (provider.kind === 'raw') return '高级 YAML'
  const behavior = { domain: 'Domain', ipcidr: 'IP-CIDR', classical: 'Classical' }[provider.behavior]
  return includeFormat ? [behavior, provider.format?.toUpperCase()].filter(Boolean).join(' · ') : behavior
}
