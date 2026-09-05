import { isAlias, isMap, isPair, isScalar, isSeq, parseDocument } from 'yaml'
import type { Document, Node, Pair, YAMLMap } from 'yaml'
import type {
  ProxyGroupDraft,
  ProxyGroupMemberDraft,
  RuleDraft,
  RuleProviderDraft,
  RuleProviderProxyDraft,
  RuleTargetDraft,
  SourceSlotDraft,
  StructuredProxyGroupDraft,
  StructuredRuleProviderDraft,
  StructuredRuleDraft,
  SupportedLoadBalanceStrategy,
  SupportedProxyGroupType,
  SupportedRuleType,
  VisualIssue,
  VisualTemplateDraft,
  GeoSettingsDraft,
} from './model'

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
const PROVIDER_TYPES = new Set(['http', 'file', 'inline'])
const PROVIDER_BEHAVIORS = new Set(['domain', 'ipcidr', 'classical'])
const PROVIDER_FORMATS = new Set(['yaml', 'text', 'mrs'])
const PROVIDER_KEYS = new Set([
  'type',
  'behavior',
  'format',
  'url',
  'path',
  'interval',
  'proxy',
  'path-in-bundle',
  'size-limit',
  'header',
  'payload',
])
const GROUP_KEYS = new Set([
  'name',
  'type',
  'proxies',
  'url',
  'interval',
  'tolerance',
  'strategy',
  'default-selected',
  'include-all',
  'include-all-proxies',
  'include-all-providers',
  'filter',
  'exclude-filter',
  'exclude-type',
])

export type VisualParseResult = {
  draft: VisualTemplateDraft
  warnings: VisualIssue[]
}

const SOURCE_SLOT_KEY_PATTERN = /^__WANGWANG_SOURCE_SLOT_[A-Za-z0-9_-]{6}__$/

export function inferSourceSlots(yamlText: string): SourceSlotDraft[] {
  const doc = parseDocument(yamlText)
  if (doc.errors.length || !isMap(doc.contents)) return []
  const root = doc.toJS() as Record<string, unknown>
  if (!Array.isArray(root['proxy-groups'])) return []
  const keys = [
    ...new Set(
      root['proxy-groups'].flatMap((group) =>
        object(group) && Array.isArray(group.proxies)
          ? group.proxies.filter(
              (value): value is string => typeof value === 'string' && SOURCE_SLOT_KEY_PATTERN.test(value),
            )
          : [],
      ),
    ),
  ]
  return keys.map((key, index) => ({ key, name: `节点源槽位 ${index + 1}` }))
}

export function parseGeoSettings(root: Record<string, unknown>): { draft: GeoSettingsDraft; warnings: VisualIssue[] } {
  const warnings: VisualIssue[] = []
  const bool = (key: string, field: 'geodata-mode' | 'geo-auto-update') => {
    const value = root[key]
    if (value === undefined || typeof value === 'boolean') return value as boolean | undefined
    warnings.push({
      level: 'warning',
      code: `GEO_${field === 'geodata-mode' ? 'GEODATA_MODE' : 'AUTO_UPDATE'}_INVALID`,
      message: `${field} 必须是布尔值`,
      geoField: field,
    })
    return undefined
  }
  const geox = object(root['geox-url']) ? (root['geox-url'] as Record<string, unknown>) : {}
  const interval = root['geo-update-interval']
  if (interval !== undefined && typeof interval !== 'number')
    warnings.push({
      level: 'warning',
      code: 'GEO_UPDATE_INTERVAL_INVALID',
      message: 'geo-update-interval 必须是数字',
      geoField: 'geo-update-interval',
    })
  return {
    draft: {
      geodataMode: bool('geodata-mode', 'geodata-mode'),
      geoAutoUpdate: bool('geo-auto-update', 'geo-auto-update'),
      geoUpdateInterval: typeof interval === 'number' ? interval : undefined,
      geoxUrl: Object.fromEntries(
        ['geoip', 'geosite', 'mmdb', 'asn']
          .filter((key) => typeof geox[key] === 'string')
          .map((key) => [key, geox[key]]),
      ),
    },
    warnings,
  }
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

function parseMember(value: string, groupIds: Map<string, string>, slotKeys: Set<string>): ProxyGroupMemberDraft {
  if (slotKeys.has(value)) return { kind: 'source-slot', slotKey: value }
  if (value === 'DIRECT' || value === 'REJECT') return { kind: 'builtin', value }
  const groupId = groupIds.get(value)
  return groupId ? { kind: 'group', groupId } : { kind: 'raw', value }
}

function parseProviderProxy(value: unknown, groupIds: Map<string, string>): RuleProviderProxyDraft | undefined {
  if (typeof value !== 'string') return undefined
  const groupId = groupIds.get(value)
  if (groupId) return { kind: 'group', groupId }
  if (value === 'DIRECT') return { kind: 'builtin', value }
  return { kind: 'raw', value }
}

function scalarValue(value: unknown) {
  return isScalar(value) ? String(value.value) : String(value)
}

function hasUnsafeProviderNode(node: unknown): boolean {
  if (!node) return false
  if (isAlias(node)) return true
  if (isPair(node))
    return scalarValue(node.key) === '<<' || hasUnsafeProviderNode(node.key) || hasUnsafeProviderNode(node.value)
  if (isMap(node) || isSeq(node)) return Boolean(node.tag) || node.items.some((item) => hasUnsafeProviderNode(item))
  return isScalar(node) && Boolean(node.tag)
}

function parseRuleProviders(
  doc: Document,
  root: Record<string, unknown>,
  groupIds: Map<string, string>,
): { providers: RuleProviderDraft[]; providerIds: Map<string, string> } {
  const node = doc.get('rule-providers', true)
  if (node === undefined) return { providers: [], providerIds: new Map() }
  if (!isMap(node) || !object(root['rule-providers'])) throw new Error('rule-providers 必须是对象')
  const rows = root['rule-providers'] as Record<string, unknown>
  const providerIds = new Map<string, string>()
  const providers = node.items.map((pair, index): RuleProviderDraft => {
    const name = scalarValue(pair.key)
    const id = runtimeId('provider', index)
    providerIds.set(name, id)
    const value = rows[name]
    const raw = (reason: string): RuleProviderDraft => ({
      kind: 'raw',
      id,
      name,
      reason,
      rawYaml: pair.value ? String(pair.value) : '',
    })
    if (hasUnsafeProviderNode(pair.key) || hasUnsafeProviderNode(pair.value)) return raw('yaml-merge')
    if (!object(value)) return raw('unsupported-node')
    if (!PROVIDER_TYPES.has(String(value.type)) || !PROVIDER_BEHAVIORS.has(String(value.behavior)))
      return raw('unsupported-fields')
    if (value.format !== undefined && !PROVIDER_FORMATS.has(String(value.format))) return raw('unsupported-fields')
    const stringFields = ['url', 'path', 'proxy', 'path-in-bundle']
    const numberFields = ['interval', 'size-limit']
    const validHeader =
      value.header === undefined ||
      (object(value.header) &&
        Object.values(value.header).every(
          (item) =>
            typeof item === 'string' || (Array.isArray(item) && item.every((entry) => typeof entry === 'string')),
        ))
    if (
      stringFields.some((key) => value[key] !== undefined && typeof value[key] !== 'string') ||
      numberFields.some((key) => value[key] !== undefined && typeof value[key] !== 'number') ||
      (value.payload !== undefined &&
        (!Array.isArray(value.payload) || value.payload.some((item) => typeof item !== 'string'))) ||
      !validHeader
    )
      return raw('unsupported-fields')
    const header = object(value.header)
      ? Object.fromEntries(
          Object.entries(value.header).map(([key, item]) => [
            key,
            Array.isArray(item) ? item.map(String) : [String(item)],
          ]),
        )
      : undefined
    const provider: StructuredRuleProviderDraft = {
      kind: 'structured',
      id,
      name,
      type: value.type as StructuredRuleProviderDraft['type'],
      behavior: value.behavior as StructuredRuleProviderDraft['behavior'],
      format: value.type === 'inline' ? undefined : (value.format as StructuredRuleProviderDraft['format']),
      url: typeof value.url === 'string' ? value.url : undefined,
      path: typeof value.path === 'string' ? value.path : undefined,
      interval: typeof value.interval === 'number' ? value.interval : undefined,
      proxy: parseProviderProxy(value.proxy, groupIds),
      pathInBundle: typeof value['path-in-bundle'] === 'string' ? value['path-in-bundle'] : undefined,
      sizeLimit: typeof value['size-limit'] === 'number' ? value['size-limit'] : undefined,
      header,
      payload: Array.isArray(value.payload) ? value.payload.map(String) : undefined,
      extras: Object.fromEntries(Object.entries(value).filter(([key]) => !PROVIDER_KEYS.has(key))),
    }
    return provider
  })
  return { providers, providerIds }
}

function parseRule(
  value: string,
  index: number,
  groupIds: Map<string, string>,
  providerIds: Map<string, string>,
): RuleDraft {
  const tokens = value.split(',')
  const type = tokens[0] as SupportedRuleType
  const id = runtimeId('rule', index)
  if (type === 'MATCH' && tokens.length === 2)
    return { kind: 'structured', id, type, target: parseTarget(tokens[1], groupIds), noResolve: false }
  if (type === 'RULE-SET' && (tokens.length === 3 || (tokens.length === 4 && tokens[3] === 'no-resolve'))) {
    const providerId = providerIds.get(tokens[1])
    return {
      kind: 'structured',
      id,
      type,
      provider: providerId ? { kind: 'provider', providerId } : { kind: 'raw', value: tokens[1] },
      target: parseTarget(tokens[2], groupIds),
      noResolve: tokens[3] === 'no-resolve',
    }
  }
  if (!VALUE_RULE_TYPES.has(type)) return { kind: 'raw', id, raw: value }
  const noResolve = tokens.length === 4 && tokens[3] === 'no-resolve' && NO_RESOLVE_TYPES.has(type)
  if (tokens.length !== 3 && !noResolve) return { kind: 'raw', id, raw: value }
  return {
    kind: 'structured',
    id,
    type: type as Exclude<SupportedRuleType, 'RULE-SET' | 'MATCH'>,
    value: tokens[1],
    target: parseTarget(tokens[2], groupIds),
    noResolve,
  }
}

export function parseVisualTemplate(yamlText: string, sourceSlots: SourceSlotDraft[]): VisualParseResult {
  const doc = parseDocument(yamlText)
  if (doc.errors.length) throw new Error(`YAML 解析失败：${doc.errors[0].message}`)
  if (!isMap(doc.contents)) throw new Error('模板根节点必须是对象')
  const root = doc.toJS() as Record<string, unknown>
  if (!Array.isArray(root['proxy-groups'])) throw new Error('proxy-groups 必须是数组')
  if (root.rules !== undefined && (!Array.isArray(root.rules) || root.rules.some((rule) => typeof rule !== 'string')))
    throw new Error('rules 必须是字符串数组')

  if (Object.hasOwn(root, 'x-wangwang')) throw new Error('模板 YAML 不能包含 x-wangwang')
  const rows = root['proxy-groups']
  const geo = parseGeoSettings(root)
  const slotKeys = new Set(sourceSlots.map(({ key }) => key))
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
      members: ((value.proxies as string[] | undefined) || []).map((member) => parseMember(member, groupIds, slotKeys)),
      defaultSelected: typeof value['default-selected'] === 'string' ? value['default-selected'] : undefined,
      includeAllProxies:
        typeof value['include-all-proxies'] === 'boolean'
          ? value['include-all-proxies']
          : typeof value['include-all'] === 'boolean'
            ? value['include-all']
            : undefined,
      includeAllProviders:
        typeof value['include-all-providers'] === 'boolean'
          ? value['include-all-providers']
          : typeof value['include-all'] === 'boolean'
            ? value['include-all']
            : undefined,
      filter: typeof value.filter === 'string' ? value.filter : undefined,
      excludeFilter: typeof value['exclude-filter'] === 'string' ? value['exclude-filter'] : undefined,
      excludeType: typeof value['exclude-type'] === 'string' ? value['exclude-type'] : undefined,
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
  const { providers: ruleProviders, providerIds } = parseRuleProviders(doc, root, groupIds)
  const rules = ((root.rules as string[] | undefined) || []).map((rule, index) =>
    parseRule(rule, index, groupIds, providerIds),
  )
  const warnings: VisualIssue[] = [
    ...geo.warnings,
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
    ...ruleProviders
      .filter((provider) => provider.kind === 'raw')
      .map((provider) => ({
        level: 'warning' as const,
        code: 'RAW_RULE_PROVIDER',
        message: `规则集数据源“${provider.name}”仅支持 YAML 编辑`,
        providerId: provider.id,
      })),
  ]
  return { draft: { geo: geo.draft, sourceSlots, groups, ruleProviders, rules }, warnings }
}

function applyOptionalRootField(doc: Document, key: string, value: unknown) {
  if (value === undefined) return
  if (value === null) doc.delete(key)
  else doc.set(key, value)
}

function applyMapField(map: YAMLMap, key: string, value: unknown) {
  if (value === undefined) return
  if (value === null) map.delete(key)
  else map.set(key, value)
}

export function applyGeoSettings(doc: Document, geo: GeoSettingsDraft) {
  applyOptionalRootField(doc, 'geodata-mode', geo.geodataMode)
  applyOptionalRootField(doc, 'geo-auto-update', geo.geoAutoUpdate)
  applyOptionalRootField(doc, 'geo-update-interval', geo.geoUpdateInterval)
  const value = geo.geoxUrl
  if (!['geoip', 'geosite', 'mmdb', 'asn'].some((key) => value[key as keyof typeof value] !== undefined)) return
  let node = doc.get('geox-url', true) as unknown
  if (!isMap(node)) {
    node = doc.createNode({}) as YAMLMap
    doc.set('geox-url', node)
  }
  const map = node as YAMLMap
  ;(['geoip', 'geosite', 'mmdb', 'asn'] as const).forEach((key) => applyMapField(map, key, value[key]))
  if (!map.items.length) doc.delete('geox-url')
}

function targetValue(target: RuleTargetDraft, names: Map<string, string>) {
  return target.kind === 'group' ? names.get(target.groupId) || '' : target.value
}

function memberValue(member: ProxyGroupMemberDraft, names: Map<string, string>) {
  if (member.kind === 'source-slot') return member.slotKey
  return member.kind === 'group' ? names.get(member.groupId) || '' : member.value
}

function providerProxyValue(proxy: RuleProviderProxyDraft | undefined, names: Map<string, string>) {
  if (!proxy) return undefined
  return proxy.kind === 'group' ? names.get(proxy.groupId) || '' : proxy.value
}

function serializeRuleProvider(provider: StructuredRuleProviderDraft, groupNames: Map<string, string>) {
  const value: Record<string, unknown> = {
    ...provider.extras,
    type: provider.type,
    behavior: provider.behavior,
  }
  if (provider.type !== 'inline' && provider.format) value.format = provider.format
  if (provider.url) value.url = provider.url
  if (provider.path) value.path = provider.path
  if (provider.interval !== undefined) value.interval = provider.interval
  const proxy = providerProxyValue(provider.proxy, groupNames)
  if (proxy) value.proxy = proxy
  if (provider.pathInBundle) value['path-in-bundle'] = provider.pathInBundle
  if (provider.sizeLimit !== undefined) value['size-limit'] = provider.sizeLimit
  if (provider.header && Object.keys(provider.header).length) value.header = provider.header
  if (provider.payload?.length) value.payload = provider.payload
  return value
}

function pairKey(pair: Pair) {
  return scalarValue(pair.key)
}

function providerContent(provider: StructuredRuleProviderDraft) {
  const { id: _id, name: _name, ...content } = provider
  return JSON.stringify(content)
}

function setProviderField(map: YAMLMap, key: string, value: unknown) {
  if (value === undefined) map.delete(key)
  else map.set(key, value)
}

function applyStructuredProviderFields(
  map: YAMLMap,
  provider: StructuredRuleProviderDraft,
  previous: StructuredRuleProviderDraft | undefined,
  groupNames: Map<string, string>,
) {
  const value = serializeRuleProvider(provider, groupNames)
  PROVIDER_KEYS.forEach((key) => setProviderField(map, key, value[key]))
  if (JSON.stringify(previous?.extras || {}) === JSON.stringify(provider.extras)) return
  new Set([...Object.keys(previous?.extras || {}), ...Object.keys(provider.extras)]).forEach((key) =>
    setProviderField(map, key, value[key]),
  )
}

function applyRuleProviders(
  doc: Document,
  nextDraft: VisualTemplateDraft,
  previousDraft: VisualTemplateDraft | undefined,
  groupNames: Map<string, string>,
) {
  let node = doc.get('rule-providers', true)
  if (node !== undefined && !isMap(node)) throw new Error('rule-providers 必须是对象')
  if (!node) {
    if (!nextDraft.ruleProviders.length) return
    node = doc.createNode({}) as YAMLMap
    doc.set('rule-providers', node)
  }
  const map = node as YAMLMap
  const previousById = new Map(previousDraft?.ruleProviders.map((provider) => [provider.id, provider]))
  const previousGroupNames = new Map(previousDraft?.groups.map((group) => [group.id, group.name]))
  const nextIds = new Set(nextDraft.ruleProviders.map((provider) => provider.id))
  previousDraft?.ruleProviders.forEach((provider) => {
    if (!nextIds.has(provider.id)) map.delete(provider.name)
  })
  nextDraft.ruleProviders.forEach((provider) => {
    const previous = previousById.get(provider.id)
    const oldName = previous?.name || provider.name
    const pair = map.items.find((item) => pairKey(item as Pair) === oldName) as Pair | undefined
    if (pair && oldName !== provider.name) pair.key = doc.createNode(provider.name) as Node
    if (provider.kind === 'raw') return
    if (!pair || !isMap(pair.value)) {
      const value = doc.createNode(serializeRuleProvider(provider, groupNames)) as Node
      if (pair) pair.value = value
      else map.set(provider.name, value)
      return
    }
    const previousStructured = previous?.kind === 'structured' ? previous : undefined
    const proxyChanged =
      providerProxyValue(previousStructured?.proxy, previousGroupNames) !==
      providerProxyValue(provider.proxy, groupNames)
    if (!previousStructured || providerContent(previousStructured) !== providerContent(provider))
      applyStructuredProviderFields(pair.value, provider, previousStructured, groupNames)
    else if (proxyChanged) setProviderField(pair.value, 'proxy', providerProxyValue(provider.proxy, groupNames))
  })
  if (!map.items.length) doc.delete('rule-providers')
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
  if (group.includeAllProxies !== undefined) value['include-all-proxies'] = group.includeAllProxies
  if (group.includeAllProviders !== undefined) value['include-all-providers'] = group.includeAllProviders
  if (group.filter) value.filter = group.filter
  if (group.excludeFilter) value['exclude-filter'] = group.excludeFilter
  if (group.excludeType) value['exclude-type'] = group.excludeType
  if (group.type !== 'select') {
    value.url = group.url
    value.interval = group.interval
  }
  if (group.type === 'url-test' && group.tolerance !== undefined) value.tolerance = group.tolerance
  if (group.type === 'load-balance' && group.strategy) value.strategy = group.strategy
  return value
}

function serializeRule(rule: RuleDraft, names: Map<string, string>, providerNames: Map<string, string>) {
  if (rule.kind === 'raw') return rule.raw
  const target = targetValue(rule.target, names)
  if (rule.type === 'MATCH') return `MATCH,${target}`
  const value =
    rule.type === 'RULE-SET'
      ? rule.provider.kind === 'provider'
        ? providerNames.get(rule.provider.providerId) || ''
        : rule.provider.value
      : rule.value
  return [rule.type, value, target, rule.noResolve ? 'no-resolve' : ''].filter(Boolean).join(',')
}

export function applyVisualTemplate(yamlText: string, draft: VisualTemplateDraft, previousDraft?: VisualTemplateDraft) {
  const doc = parseDocument(yamlText)
  if (doc.errors.length) throw new Error(`YAML 解析失败：${doc.errors[0].message}`)
  if (!isMap(doc.contents)) throw new Error('模板根节点必须是对象')
  doc.delete('x-wangwang')
  applyGeoSettings(doc, draft.geo)
  const names = new Map(draft.groups.map((group) => [group.id, group.name]))
  const providerNames = new Map(draft.ruleProviders.map((provider) => [provider.id, provider.name]))
  doc.set(
    'proxy-groups',
    draft.groups.map((group) => serializeGroup(group, names)),
  )
  applyRuleProviders(doc, draft, previousDraft, names)
  doc.set(
    'rules',
    draft.rules.map((rule) => serializeRule(rule, names, providerNames)),
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

export function findPotentialRawProviderReferences(draft: VisualTemplateDraft, providerName: string) {
  const escaped = providerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`RULE-SET,\\s*${escaped}(?=\\s*[,)]|$)`)
  const ruleIds = draft.rules.filter((rule) => rule.kind === 'raw' && pattern.test(rule.raw)).map((rule) => rule.id)
  return { ruleIds, count: ruleIds.length }
}

export function uniqueName(base: string, groups: ProxyGroupDraft[]) {
  const names = new Set(groups.map((group) => group.name))
  if (!names.has(base)) return base
  let suffix = 2
  while (names.has(`${base} ${suffix}`)) suffix += 1
  return `${base} ${suffix}`
}

export function newGroup(
  type: SupportedProxyGroupType,
  groups: ProxyGroupDraft[],
  initialSlot?: SourceSlotDraft,
): StructuredProxyGroupDraft {
  const base =
    type === 'select' ? '代理组' : type === 'url-test' ? '自动选择' : type === 'fallback' ? '故障转移' : '负载均衡'
  return {
    kind: 'structured',
    id: runtimeId('group', groups.length),
    name: uniqueName(base, groups),
    type,
    members: initialSlot ? [{ kind: 'source-slot', slotKey: initialSlot.key }] : [],
    extras: {},
    ...(type === 'select' ? {} : { url: 'https://www.gstatic.com/generate_204', interval: 300 }),
    ...(type === 'url-test' ? { tolerance: 50 } : {}),
    ...(type === 'load-balance' ? { strategy: 'consistent-hashing' } : {}),
  }
}

export function newRule(target: RuleTargetDraft): StructuredRuleDraft {
  return { kind: 'structured', id: runtimeId('rule', 0), type: 'DOMAIN', value: '', target, noResolve: false }
}

export function uniqueProviderName(base: string, providers: RuleProviderDraft[]) {
  const names = new Set(providers.map((provider) => provider.name))
  if (!names.has(base)) return base
  let suffix = 2
  while (names.has(`${base} ${suffix}`)) suffix += 1
  return `${base} ${suffix}`
}

export function newRuleProvider(providers: RuleProviderDraft[]): StructuredRuleProviderDraft {
  return {
    kind: 'structured',
    id: runtimeId('provider', providers.length),
    name: uniqueProviderName('规则集数据源', providers),
    type: 'http',
    behavior: 'domain',
    format: 'mrs',
    interval: 86400,
    url: '',
    extras: {},
  }
}
