export type VisualTemplateDraft = {
  groups: ProxyGroupDraft[]
  rules: RuleDraft[]
}

export type SupportedProxyGroupType = 'select' | 'url-test' | 'fallback'

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
  url?: string
  interval?: number
  tolerance?: number
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

export type SupportedRuleType =
  | 'DOMAIN'
  | 'DOMAIN-SUFFIX'
  | 'DOMAIN-KEYWORD'
  | 'GEOSITE'
  | 'GEOIP'
  | 'IP-CIDR'
  | 'IP-CIDR6'
  | 'MATCH'

export type RuleTargetDraft =
  | { kind: 'group'; groupId: string }
  | { kind: 'builtin'; value: 'DIRECT' | 'REJECT' }
  | { kind: 'raw'; value: string }

export type StructuredRuleDraft = {
  kind: 'structured'
  id: string
  type: SupportedRuleType
  value?: string
  target: RuleTargetDraft
  noResolve: boolean
}

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
  ruleId?: string
}
