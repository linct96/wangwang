import { isMap, parseDocument } from 'yaml'
import type {
  ProxyGroupDraft,
  ProxyGroupMemberDraft,
  RuleDraft,
  RuleTargetDraft,
  StructuredProxyGroupDraft,
  StructuredRuleDraft,
  SupportedLoadBalanceStrategy,
  SupportedProxyGroupType,
  SupportedRuleType,
  VisualIssue,
  VisualTemplateDraft,
} from './model'

const ALL_PROXIES = '__WANGWANG_ALL_PROXIES__'
const GROUP_TYPES = new Set<SupportedProxyGroupType>(['select', 'url-test', 'fallback', 'load-balance'])
const VALUE_RULE_TYPES = new Set<SupportedRuleType>([
  'DOMAIN',
  'DOMAIN-SUFFIX',
  'DOMAIN-KEYWORD',
  'GEOSITE',
  'GEOIP',
  'IP-CIDR',
  'IP-CIDR6',
])
const NO_RESOLVE_TYPES = new Set<SupportedRuleType>(['GEOIP', 'IP-CIDR', 'IP-CIDR6'])
const GROUP_KEYS = new Set([
  'name',
  'type',
  'proxies',
  'url',
  'interval',
  'tolerance',
  'strategy',
  'default-selected',
  'filter',
  'exclude-filter',
])

export type VisualParseResult = {
  draft: VisualTemplateDraft
  warnings: VisualIssue[]
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function runtimeId(prefix: string, index: number) {
  return `${prefix}-${index}-${crypto.randomUUID()}`
}

function parseTarget(value: string, groupIds: Map<string, string>): RuleTargetDraft {
  const groupId = groupIds.get(value)
  if (groupId) return { kind: 'group', groupId }
  if (value === 'DIRECT' || value === 'REJECT') return { kind: 'builtin', value }
  return { kind: 'raw', value }
}

function parseMember(value: string, groupIds: Map<string, string>): ProxyGroupMemberDraft {
  if (value === ALL_PROXIES) return { kind: 'all-proxies' }
  if (value === 'DIRECT' || value === 'REJECT') return { kind: 'builtin', value }
  const groupId = groupIds.get(value)
  return groupId ? { kind: 'group', groupId } : { kind: 'raw', value }
}

function parseRule(value: string, index: number, groupIds: Map<string, string>): RuleDraft {
  const tokens = value.split(',')
  const type = tokens[0] as SupportedRuleType
  const id = runtimeId('rule', index)
  if (type === 'MATCH' && tokens.length === 2)
    return { kind: 'structured', id, type, target: parseTarget(tokens[1], groupIds), noResolve: false }
  if (!VALUE_RULE_TYPES.has(type)) return { kind: 'raw', id, raw: value }
  const noResolve = tokens.length === 4 && tokens[3] === 'no-resolve' && NO_RESOLVE_TYPES.has(type)
  if (tokens.length !== 3 && !noResolve) return { kind: 'raw', id, raw: value }
  return {
    kind: 'structured',
    id,
    type,
    value: tokens[1],
    target: parseTarget(tokens[2], groupIds),
    noResolve,
  }
}

export function parseVisualTemplate(yamlText: string): VisualParseResult {
  const doc = parseDocument(yamlText)
  if (doc.errors.length) throw new Error(`YAML 解析失败：${doc.errors[0].message}`)
  if (!isMap(doc.contents)) throw new Error('模板根节点必须是对象')
  const root = doc.toJS() as Record<string, unknown>
  if (!Array.isArray(root['proxy-groups'])) throw new Error('proxy-groups 必须是数组')
  if (root.rules !== undefined && (!Array.isArray(root.rules) || root.rules.some((rule) => typeof rule !== 'string')))
    throw new Error('rules 必须是字符串数组')

  const rows = root['proxy-groups']
  const groupIds = new Map<string, string>()
  rows.forEach((row, index) => {
    if (!object(row) || typeof row.name !== 'string' || typeof row.type !== 'string')
      throw new Error(`第 ${index + 1} 个代理组缺少合法的 name 或 type`)
    groupIds.set(row.name, runtimeId('group', index))
  })

  const groups: ProxyGroupDraft[] = rows.map((row) => {
    const value = row as Record<string, unknown>
    const id = groupIds.get(value.name as string)!
    const name = value.name as string
    const type = value.type as string
    if (!GROUP_TYPES.has(type as SupportedProxyGroupType)) return { kind: 'raw', id, name, type, raw: value }
    if (
      value.proxies !== undefined &&
      (!Array.isArray(value.proxies) || value.proxies.some((item) => typeof item !== 'string'))
    )
      throw new Error(`代理组“${name}”的 proxies 必须是字符串数组`)
    const extras = Object.fromEntries(
      Object.entries(value).filter(([key]) => !GROUP_KEYS.has(key) || (type === 'fallback' && key === 'tolerance')),
    )
    const group: StructuredProxyGroupDraft = {
      kind: 'structured',
      id,
      name,
      type: type as SupportedProxyGroupType,
      members: ((value.proxies as string[] | undefined) || []).map((member) => parseMember(member, groupIds)),
      defaultSelected: typeof value['default-selected'] === 'string' ? value['default-selected'] : undefined,
      filter: typeof value.filter === 'string' ? value.filter : undefined,
      excludeFilter: typeof value['exclude-filter'] === 'string' ? value['exclude-filter'] : undefined,
      extras,
    }
    if (type !== 'select') {
      group.url = typeof value.url === 'string' ? value.url : ''
      group.interval = typeof value.interval === 'number' ? value.interval : 0
    }
    if (type === 'url-test') group.tolerance = typeof value.tolerance === 'number' ? value.tolerance : 0
    if (type === 'load-balance')
      group.strategy =
        typeof value.strategy === 'string' ? (value.strategy as SupportedLoadBalanceStrategy) : 'consistent-hashing'
    return group
  })
  const rules = ((root.rules as string[] | undefined) || []).map((rule, index) => parseRule(rule, index, groupIds))
  const warnings: VisualIssue[] = [
    ...groups
      .filter((group) => group.kind === 'raw')
      .map((group) => ({
        level: 'warning' as const,
        code: 'RAW_GROUP',
        message: `代理组“${group.name}”仅支持 YAML 编辑`,
        groupId: group.id,
      })),
    ...rules
      .filter((rule) => rule.kind === 'raw')
      .map((rule) => ({
        level: 'warning' as const,
        code: 'RAW_RULE',
        message: '存在仅支持 YAML 编辑的高级规则',
        ruleId: rule.id,
      })),
  ]
  return { draft: { groups, rules }, warnings }
}

function targetValue(target: RuleTargetDraft, names: Map<string, string>) {
  return target.kind === 'group' ? names.get(target.groupId) || '' : target.value
}

function memberValue(member: ProxyGroupMemberDraft, names: Map<string, string>) {
  if (member.kind === 'all-proxies') return ALL_PROXIES
  return member.kind === 'group' ? names.get(member.groupId) || '' : member.value
}

function serializeGroup(group: ProxyGroupDraft, names: Map<string, string>) {
  if (group.kind === 'raw') return group.raw
  const value: Record<string, unknown> = {
    ...group.extras,
    name: group.name,
    type: group.type,
    proxies: group.members.map((member) => memberValue(member, names)),
  }
  if (group.type === 'select' && group.defaultSelected) value['default-selected'] = group.defaultSelected
  if (group.filter) value.filter = group.filter
  if (group.excludeFilter) value['exclude-filter'] = group.excludeFilter
  if (group.type !== 'select') {
    value.url = group.url
    value.interval = group.interval
  }
  if (group.type === 'url-test' && group.tolerance !== undefined) value.tolerance = group.tolerance
  if (group.type === 'load-balance' && group.strategy) value.strategy = group.strategy
  return value
}

function serializeRule(rule: RuleDraft, names: Map<string, string>) {
  if (rule.kind === 'raw') return rule.raw
  const target = targetValue(rule.target, names)
  if (rule.type === 'MATCH') return `MATCH,${target}`
  return [rule.type, rule.value || '', target, rule.noResolve && NO_RESOLVE_TYPES.has(rule.type) ? 'no-resolve' : '']
    .filter(Boolean)
    .join(',')
}

export function applyVisualTemplate(yamlText: string, draft: VisualTemplateDraft) {
  const doc = parseDocument(yamlText)
  if (doc.errors.length) throw new Error(`YAML 解析失败：${doc.errors[0].message}`)
  if (!isMap(doc.contents)) throw new Error('模板根节点必须是对象')
  const names = new Map(draft.groups.map((group) => [group.id, group.name]))
  doc.set(
    'proxy-groups',
    draft.groups.map((group) => serializeGroup(group, names)),
  )
  doc.set(
    'rules',
    draft.rules.map((rule) => serializeRule(rule, names)),
  )
  return String(doc)
}

function rawContains(value: unknown, groupName: string): boolean {
  if (typeof value === 'string') return value === groupName
  if (Array.isArray(value)) return value.some((item) => rawContains(item, groupName))
  return object(value) && Object.values(value).some((item) => rawContains(item, groupName))
}

export function findPotentialRawReferences(draft: VisualTemplateDraft, groupName: string) {
  const ruleIds = draft.rules
    .filter((rule) => rule.kind === 'raw' && rule.raw.split(',').some((token) => token.trim() === groupName))
    .map((rule) => rule.id)
  const groupIds = draft.groups
    .filter((group) => {
      if (group.kind !== 'raw') return false
      const references = Object.fromEntries(Object.entries(group.raw).filter(([key]) => key !== 'name'))
      return rawContains(references, groupName)
    })
    .map((group) => group.id)
  return { groupIds, ruleIds, count: groupIds.length + ruleIds.length }
}

function renameRawValue(value: unknown, oldName: string, newName: string): unknown {
  if (typeof value === 'string') return value === oldName ? newName : value
  if (Array.isArray(value)) return value.map((item) => renameRawValue(item, oldName, newName))
  if (!object(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renameRawValue(item, oldName, newName)]))
}

/** 同步更新 RAW 中可确定为代理组名称的精确引用，避免改动普通文本。 */
export function renameRawReferences(draft: VisualTemplateDraft, oldName: string, newName: string): VisualTemplateDraft {
  if (!oldName || oldName === newName) return draft
  return {
    groups: draft.groups.map((group) =>
      group.kind === 'raw'
        ? {
            ...group,
            raw: Object.fromEntries(
              Object.entries(group.raw).map(([key, value]) => [
                key,
                key === 'name' ? value : renameRawValue(value, oldName, newName),
              ]),
            ),
          }
        : group,
    ),
    rules: draft.rules.map((rule) => {
      if (rule.kind !== 'raw') return rule
      const raw = rule.raw
        .split(',')
        .map((token) => (token.trim() === oldName ? token.replace(oldName, newName) : token))
        .join(',')
      return raw === rule.raw ? rule : { ...rule, raw }
    }),
  }
}

export function uniqueName(base: string, groups: ProxyGroupDraft[]) {
  const names = new Set(groups.map((group) => group.name))
  if (!names.has(base)) return base
  let suffix = 2
  while (names.has(`${base} ${suffix}`)) suffix += 1
  return `${base} ${suffix}`
}

export function newGroup(type: SupportedProxyGroupType, groups: ProxyGroupDraft[]): StructuredProxyGroupDraft {
  const base =
    type === 'select' ? '代理组' : type === 'url-test' ? '自动选择' : type === 'fallback' ? '故障转移' : '负载均衡'
  return {
    kind: 'structured',
    id: runtimeId('group', groups.length),
    name: uniqueName(base, groups),
    type,
    members: [{ kind: 'all-proxies' }],
    extras: {},
    ...(type === 'select' ? {} : { url: 'https://www.gstatic.com/generate_204', interval: 300 }),
    ...(type === 'url-test' ? { tolerance: 50 } : {}),
    ...(type === 'load-balance' ? { strategy: 'consistent-hashing' } : {}),
  }
}

export function newRule(target: RuleTargetDraft): StructuredRuleDraft {
  return { kind: 'structured', id: runtimeId('rule', 0), type: 'DOMAIN', value: '', target, noResolve: false }
}
