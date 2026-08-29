export type VisualTemplateDraft = {
  groups: ProxyGroupDraft[]
  rules: RuleDraft[]
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
