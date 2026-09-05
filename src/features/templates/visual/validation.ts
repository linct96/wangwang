import type {
  RuleDraft,
  RuleProviderDraft,
  RuleSetRuleDraft,
  RuleTargetDraft,
  VisualIssue,
  VisualTemplateDraft,
} from './model'

const URL_TYPES = new Set(['url-test', 'fallback', 'load-balance'])
const NO_RESOLVE_TYPES = new Set(['GEOIP', 'IP-CIDR', 'IP-CIDR6'])
const SOURCE_SLOT_KEY_PATTERN = /^__WANGWANG_SOURCE_SLOT_[A-Za-z0-9_-]{6}__$/

export function resolvePresetNoResolve(provider: RuleProviderDraft | undefined, requested: boolean) {
  return Boolean(requested && provider?.kind === 'structured' && provider.behavior === 'ipcidr')
}

function canUseNoResolveWithProvider(rule: RuleDraft, provider: RuleProviderDraft | undefined) {
  if (rule.kind !== 'structured') return false
  if (NO_RESOLVE_TYPES.has(rule.type)) return true
  if (rule.type !== 'RULE-SET' || rule.provider.kind !== 'provider') return false
  return provider?.kind === 'structured' && provider.behavior === 'ipcidr'
}

export function canUseNoResolve(rule: RuleDraft, draft: Pick<VisualTemplateDraft, 'ruleProviders'>) {
  if (rule.kind !== 'structured' || rule.type !== 'RULE-SET' || rule.provider.kind !== 'provider')
    return canUseNoResolveWithProvider(rule, undefined)
  const providerId = rule.provider.providerId
  const provider = draft.ruleProviders.find((item) => item.id === providerId)
  return canUseNoResolveWithProvider(rule, provider)
}

type RuleSetReference = {
  providerId: string
  ruleId: string
  index: number
  target: RuleTargetDraft
  noResolve: boolean
  matchSignature: string
}

type RuleSetMatchBucket = {
  first: RuleSetReference
  targets: Map<string, RuleSetReference>
}

function effectiveRuleSetNoResolve(rule: RuleSetRuleDraft, provider: RuleProviderDraft | undefined) {
  return Boolean(rule.noResolve && provider?.kind === 'structured' && provider.behavior === 'ipcidr')
}

function ruleTargetSignature(target: RuleTargetDraft) {
  return target.kind === 'group'
    ? JSON.stringify([target.kind, target.groupId])
    : JSON.stringify([target.kind, target.value])
}

function ruleSetMatchSignature(providerId: string, noResolve: boolean) {
  return JSON.stringify([providerId, noResolve])
}

function analyzeRuleSetReferences(
  referencesByProvider: Map<string, RuleSetReference[]>,
  providers: Map<string, RuleProviderDraft>,
  addIssue: (issue: VisualIssue) => void,
) {
  for (const [providerId, references] of referencesByProvider) {
    const provider = providers.get(providerId)
    if (!provider) continue
    const isIpProvider = provider.kind === 'structured' && provider.behavior === 'ipcidr'
    const seenNoResolve = new Set<boolean>()
    const firstNoResolve = new Map<boolean, RuleSetReference>()
    const matches = new Map<string, RuleSetMatchBucket>()

    for (const current of references) {
      const oppositeNoResolve = isIpProvider && seenNoResolve.has(!current.noResolve)
      if (oppositeNoResolve) {
        const overlap = firstNoResolve.get(!current.noResolve)
        addIssue({
          level: 'warning',
          code: 'RULE_SET_NO_RESOLVE_OVERLAP',
          message: `第 ${current.index + 1} 条规则与第 ${(overlap?.index ?? current.index) + 1} 条规则引用同一 IP 规则集，但 no-resolve 设置不同，请确认这是有意利用 DNS 解析行为`,
          ruleId: current.ruleId,
        })
      } else {
        const bucket = matches.get(current.matchSignature)
        if (bucket) {
          const target = ruleTargetSignature(current.target)
          const duplicate = bucket.targets.get(target)
          if (duplicate) {
            addIssue({
              level: 'error',
              code: 'RULE_SET_RULE_DUPLICATE',
              message: `第 ${current.index + 1} 条 RULE-SET 与第 ${duplicate.index + 1} 条规则完全重复，后续规则不会产生额外效果`,
              ruleId: current.ruleId,
            })
          } else {
            addIssue({
              level: 'error',
              code: 'RULE_SET_RULE_SHADOWED',
              message: `第 ${current.index + 1} 条规则已被第 ${bucket.first.index + 1} 条同规则集规则覆盖，目标策略不会生效`,
              ruleId: current.ruleId,
            })
          }
        }
      }

      seenNoResolve.add(current.noResolve)
      if (!firstNoResolve.has(current.noResolve)) firstNoResolve.set(current.noResolve, current)
      const bucket = matches.get(current.matchSignature)
      const target = ruleTargetSignature(current.target)
      if (bucket) {
        if (!bucket.targets.has(target)) bucket.targets.set(target, current)
      } else {
        matches.set(current.matchSignature, { first: current, targets: new Map([[target, current]]) })
      }
    }
  }
}

export function validateVisualDraft(draft: VisualTemplateDraft, initial: VisualIssue[] = []) {
  const issues = [...initial]
  const issueKeys = new Set(
    initial.map((issue) =>
      JSON.stringify([issue.code, issue.groupId, issue.providerId, issue.ruleId, issue.geoField, issue.message]),
    ),
  )
  const add = (issue: VisualIssue) => {
    const key = JSON.stringify([
      issue.code,
      issue.groupId,
      issue.providerId,
      issue.ruleId,
      issue.geoField,
      issue.message,
    ])
    if (issueKeys.has(key)) return
    issueKeys.add(key)
    issues.push(issue)
  }
  if (!draft.sourceSlots.length || draft.sourceSlots.length > 20)
    add({ level: 'error', code: 'SLOT_COUNT', message: '模板必须包含 1 到 20 个节点源槽位' })
  const slotKeys = new Set<string>()
  const slotNames = new Set<string>()
  for (const slot of draft.sourceSlots) {
    if (!SOURCE_SLOT_KEY_PATTERN.test(slot.key) || slotKeys.has(slot.key))
      add({ level: 'error', code: 'SLOT_KEY', message: '节点源槽位 key 无效或重复', slotKey: slot.key })
    if (!slot.name.trim() || slot.name.trim().length > 40 || slotNames.has(slot.name.trim()))
      add({
        level: 'error',
        code: 'SLOT_NAME',
        message: '节点源槽位名称不能为空、重复或超过 40 个字符',
        slotKey: slot.key,
      })
    slotKeys.add(slot.key)
    slotNames.add(slot.name.trim())
  }
  const usedSlots = new Set<string>()
  const groupById = new Map(draft.groups.map((group) => [group.id, group]))
  const providerById = new Map(draft.ruleProviders.map((provider) => [provider.id, provider]))
  const groupNameCounts = new Map<string, number>()
  draft.groups.forEach((group) => groupNameCounts.set(group.name, (groupNameCounts.get(group.name) || 0) + 1))
  const geo = draft.geo
  if (
    geo.geoUpdateInterval !== undefined &&
    geo.geoUpdateInterval !== null &&
    (!Number.isInteger(geo.geoUpdateInterval) || geo.geoUpdateInterval <= 0)
  )
    add({
      level: 'error',
      code: 'GEO_UPDATE_INTERVAL_INVALID',
      message: 'GEO 更新间隔必须是大于 0 的整数小时',
      geoField: 'geo-update-interval',
    })
  for (const [field, value] of Object.entries(geo.geoxUrl)) {
    if (value == null || value === '') continue
    try {
      if (!['http:', 'https:'].includes(new URL(value).protocol)) throw new Error()
    } catch {
      add({
        level: 'error',
        code: 'GEO_URL_INVALID',
        message: `${field} 必须是 http 或 https URL`,
        geoField: field as VisualIssue['geoField'],
      })
    }
  }
  draft.groups.forEach((group) => {
    if (!group.name.trim())
      add({ level: 'error', code: 'GROUP_NAME_EMPTY', message: '代理组名称不能为空', groupId: group.id })
    if ((groupNameCounts.get(group.name) || 0) > 1)
      add({ level: 'error', code: 'GROUP_NAME_DUPLICATE', message: `代理组名称重复：${group.name}`, groupId: group.id })
    if (group.kind === 'raw') {
      add({ level: 'warning', code: 'RAW_GROUP', message: `代理组“${group.name}”仅支持 YAML 编辑`, groupId: group.id })
      return
    }
    if (!group.members.length && !group.includeAllProxies && !group.includeAllProviders)
      add({
        level: 'error',
        code: 'GROUP_MEMBERS_EMPTY',
        message: `代理组“${group.name}”至少需要包含一个节点或子组`,
        groupId: group.id,
      })
    if (URL_TYPES.has(group.type)) {
      try {
        if (!group.url || !['http:', 'https:'].includes(new URL(group.url).protocol)) throw new Error()
      } catch {
        add({
          level: 'error',
          code: 'GROUP_URL_INVALID',
          message: `代理组“${group.name}”的测试 URL 无效`,
          groupId: group.id,
        })
      }
      if (!Number.isInteger(group.interval) || (group.interval || 0) <= 0)
        add({
          level: 'error',
          code: 'GROUP_INTERVAL_INVALID',
          message: `代理组“${group.name}”的 interval 必须是正整数`,
          groupId: group.id,
        })
    }
    if (group.type === 'url-test' && (!Number.isInteger(group.tolerance) || (group.tolerance || 0) < 0))
      add({
        level: 'error',
        code: 'GROUP_TOLERANCE_INVALID',
        message: `代理组“${group.name}”的 tolerance 必须是非负整数`,
        groupId: group.id,
      })
    for (const [field, value] of [
      ['filter', group.filter],
      ['exclude-filter', group.excludeFilter],
    ] as const) {
      if (!value?.trim()) continue
      try {
        value
          .split('`')
          .map((pattern) => pattern.trim())
          .filter(Boolean)
          .forEach((pattern) => (pattern.startsWith('(?i)') ? new RegExp(pattern.slice(4), 'i') : new RegExp(pattern)))
      } catch {
        add({
          level: 'error',
          code: `GROUP_${field.toUpperCase().replace('-', '_')}_INVALID`,
          message: `代理组“${group.name}”的 ${field} 包含无效正则表达式`,
          groupId: group.id,
        })
      }
    }
    if (Object.keys(group.extras).length)
      add({
        level: 'warning',
        code: 'GROUP_EXTRAS',
        message: `代理组“${group.name}”包含高级字段，保存时会保留`,
        groupId: group.id,
      })
  })

  for (const group of draft.groups) {
    if (group.kind !== 'structured') continue
    for (const member of group.members) {
      if (member.kind === 'group' && !groupById.has(member.groupId))
        add({
          level: 'error',
          code: 'GROUP_MEMBER_MISSING',
          message: `代理组“${group.name}”引用了不存在的代理组`,
          groupId: group.id,
        })
      if (member.kind === 'source-slot') {
        if (slotKeys.has(member.slotKey)) usedSlots.add(member.slotKey)
        else
          add({
            level: 'error',
            code: 'GROUP_SLOT_MISSING',
            message: `代理组“${group.name}”引用了不存在的节点源槽位`,
            groupId: group.id,
          })
      }
    }
  }
  for (const slot of draft.sourceSlots)
    if (!usedSlots.has(slot.key))
      add({
        level: 'error',
        code: 'SLOT_UNUSED',
        message: `节点源槽位“${slot.name}”未被任何代理组引用`,
        slotKey: slot.key,
      })
  const providerNames = new Map<string, number>()
  const providerPaths = new Map<string, number>()
  draft.ruleProviders.forEach((provider) => {
    providerNames.set(provider.name, (providerNames.get(provider.name) || 0) + 1)
    if (provider.kind === 'structured' && provider.path)
      providerPaths.set(provider.path, (providerPaths.get(provider.path) || 0) + 1)
  })
  draft.ruleProviders.forEach((provider) => {
    if (!provider.name.trim())
      add({ level: 'error', code: 'PROVIDER_NAME_EMPTY', message: '规则集数据源名称不能为空', providerId: provider.id })
    if ((providerNames.get(provider.name) || 0) > 1)
      add({
        level: 'error',
        code: 'PROVIDER_NAME_DUPLICATE',
        message: `规则集数据源名称重复：${provider.name}`,
        providerId: provider.id,
      })
    if (provider.kind === 'raw') {
      add({
        level: 'warning',
        code: 'RAW_RULE_PROVIDER',
        message: `规则集数据源“${provider.name}”仅支持 YAML 编辑`,
        providerId: provider.id,
      })
      return
    }
    if (provider.type === 'http') {
      if (!provider.url?.trim())
        add({
          level: 'error',
          code: 'PROVIDER_HTTP_URL_EMPTY',
          message: `规则集数据源“${provider.name}”的 URL 不能为空`,
          providerId: provider.id,
        })
      else
        try {
          if (!['http:', 'https:'].includes(new URL(provider.url).protocol)) throw new Error()
        } catch {
          add({
            level: 'error',
            code: 'PROVIDER_HTTP_URL_INVALID',
            message: `规则集数据源“${provider.name}”的 URL 无效`,
            providerId: provider.id,
          })
        }
      if (!Number.isInteger(provider.interval) || (provider.interval || 0) <= 0)
        add({
          level: 'error',
          code: 'PROVIDER_INTERVAL_INVALID',
          message: `规则集数据源“${provider.name}”的更新间隔必须是正整数`,
          providerId: provider.id,
        })
    }
    if (provider.type === 'file' && !provider.path?.trim())
      add({
        level: 'error',
        code: 'PROVIDER_FILE_PATH_EMPTY',
        message: `规则集数据源“${provider.name}”的文件路径不能为空`,
        providerId: provider.id,
      })
    if (provider.type === 'inline' && !provider.payload?.some((item) => item.trim()))
      add({
        level: 'error',
        code: 'PROVIDER_INLINE_PAYLOAD_EMPTY',
        message: `规则集数据源“${provider.name}”至少需要一条规则内容`,
        providerId: provider.id,
      })
    if (provider.path && (providerPaths.get(provider.path) || 0) > 1)
      add({
        level: 'error',
        code: 'PROVIDER_PATH_DUPLICATE',
        message: `规则集数据源缓存路径重复：${provider.path}`,
        providerId: provider.id,
      })
    if (provider.format === 'mrs' && provider.behavior === 'classical')
      add({
        level: 'error',
        code: 'PROVIDER_MRS_CLASSICAL_INVALID',
        message: 'Classical 不支持 MRS 格式',
        providerId: provider.id,
      })
    if (provider.proxy?.kind === 'group') {
      const groupId = provider.proxy.groupId
      if (!groupById.has(groupId))
        add({
          level: 'error',
          code: 'PROVIDER_PROXY_MISSING',
          message: `规则集数据源“${provider.name}”引用了不存在的下载代理`,
          providerId: provider.id,
        })
    }
    if (provider.proxy?.kind === 'raw')
      add({
        level: 'warning',
        code: 'PROVIDER_PROXY_MISSING',
        message: `规则集数据源“${provider.name}”的下载代理“${provider.proxy.value}”无法映射到代理组`,
        providerId: provider.id,
      })
    if (Object.keys(provider.extras).length)
      add({
        level: 'warning',
        code: 'RULE_PROVIDER_UNKNOWN_FIELDS',
        message: `规则集数据源“${provider.name}”包含高级字段，保存时会保留`,
        providerId: provider.id,
      })
  })
  const ruleSetReferencesByProvider = new Map<string, RuleSetReference[]>()
  let matchCount = 0
  draft.rules.forEach((rule, index) => {
    if (rule.kind === 'raw') {
      add({ level: 'warning', code: 'RAW_RULE', message: '存在仅支持 YAML 编辑的高级规则', ruleId: rule.id })
      return
    }
    if (rule.type === 'MATCH') matchCount += 1
    if (rule.type !== 'MATCH' && rule.type !== 'RULE-SET' && !rule.value.trim())
      add({
        level: 'error',
        code: 'RULE_VALUE_EMPTY',
        message: `第 ${index + 1} 条规则的匹配值不能为空`,
        ruleId: rule.id,
      })
    if (rule.type === 'RULE-SET') {
      if (rule.provider.kind === 'raw')
        add({
          level: 'error',
          code: 'RULE_SET_PROVIDER_MISSING',
          message: `第 ${index + 1} 条规则引用了不存在的数据源“${rule.provider.value}”`,
          ruleId: rule.id,
        })
      else {
        const providerId = rule.provider.providerId
        const provider = providerById.get(providerId)
        const references = ruleSetReferencesByProvider.get(providerId) || []
        references.push({
          providerId,
          ruleId: rule.id,
          index,
          target: rule.target,
          noResolve: rule.noResolve,
          matchSignature: ruleSetMatchSignature(providerId, effectiveRuleSetNoResolve(rule, provider)),
        })
        ruleSetReferencesByProvider.set(providerId, references)
        if (!provider)
          add({
            level: 'error',
            code: 'RULE_SET_PROVIDER_MISSING',
            message: `第 ${index + 1} 条规则引用了不存在的规则集数据源`,
            ruleId: rule.id,
          })
        else if (provider.kind === 'raw')
          add({
            level: 'warning',
            code: 'RULE_SET_RAW_PROVIDER_REFERENCE',
            message: `第 ${index + 1} 条规则引用了高级 YAML 数据源`,
            ruleId: rule.id,
          })
      }
    }
    if (rule.target.kind === 'group') {
      const targetGroupId = rule.target.groupId
      if (!groupById.has(targetGroupId))
        add({
          level: 'error',
          code: 'RULE_TARGET_MISSING',
          message: `第 ${index + 1} 条规则引用了不存在的代理组`,
          ruleId: rule.id,
        })
    }
    if (rule.target.kind === 'raw')
      add({
        level: 'warning',
        code: 'RAW_TARGET',
        message: `第 ${index + 1} 条规则的目标“${rule.target.value}”无法映射到代理组`,
        ruleId: rule.id,
      })
    const noResolveProvider =
      rule.type === 'RULE-SET' && rule.provider.kind === 'provider'
        ? providerById.get(rule.provider.providerId)
        : undefined
    if (rule.noResolve && !canUseNoResolveWithProvider(rule, noResolveProvider))
      add({
        level: 'error',
        code: rule.type === 'RULE-SET' ? 'RULE_SET_NO_RESOLVE_INVALID' : 'RULE_NO_RESOLVE_INVALID',
        message: `${rule.type} 不支持 no-resolve`,
        ruleId: rule.id,
      })
  })
  analyzeRuleSetReferences(ruleSetReferencesByProvider, providerById, add)
  if (matchCount > 1) add({ level: 'error', code: 'MULTIPLE_MATCH', message: '存在多个 MATCH 兜底规则' })
  const graph = new Map<string, string[]>()
  draft.groups.forEach((group) =>
    graph.set(
      group.id,
      group.kind === 'structured'
        ? group.members.filter((member) => member.kind === 'group').map((member) => member.groupId)
        : [],
    ),
  )
  const visiting = new Set<string>(),
    visited = new Set<string>()
  function dfs(id: string, path: string[]): boolean {
    if (visiting.has(id)) {
      const cycle = [...path.slice(path.indexOf(id)), id].map((item) => groupById.get(item)?.name || item)
      add({ level: 'error', code: 'GROUP_CYCLE', message: `代理组存在循环引用：${cycle.join(' → ')}`, groupId: id })
      return true
    }
    if (visited.has(id)) return false
    visiting.add(id)
    for (const next of graph.get(id) || []) dfs(next, [...path, id])
    visiting.delete(id)
    visited.add(id)
    return false
  }
  draft.groups.forEach((group) => dfs(group.id, []))
  if (draft.groups.some((group) => group.kind === 'raw'))
    add({ level: 'warning', code: 'RAW_GROUP_CYCLE', message: 'RAW 代理组未参与完整循环引用分析' })
  draft.ruleProviders.forEach((provider) => {
    const referenceCount = ruleSetReferencesByProvider.get(provider.id)?.length || 0
    if (!referenceCount)
      add({
        level: 'warning',
        code: 'RULE_PROVIDER_UNUSED',
        message: `规则集数据源“${provider.name}”尚未被分流规则引用`,
        providerId: provider.id,
      })
  })
  return issues
}

export function groupReferences(draft: VisualTemplateDraft, groupId: string) {
  return {
    groups: draft.groups.filter(
      (group) =>
        group.kind === 'structured' &&
        group.members.some((member) => member.kind === 'group' && member.groupId === groupId),
    ),
    rules: draft.rules.filter(
      (rule) => rule.kind === 'structured' && rule.target.kind === 'group' && rule.target.groupId === groupId,
    ),
    ruleProviders: draft.ruleProviders.filter(
      (provider) =>
        provider.kind === 'structured' && provider.proxy?.kind === 'group' && provider.proxy.groupId === groupId,
    ),
  }
}

export function ruleProviderReferences(draft: VisualTemplateDraft, providerId: string) {
  return draft.rules.filter(
    (rule) =>
      rule.kind === 'structured' &&
      rule.type === 'RULE-SET' &&
      rule.provider.kind === 'provider' &&
      rule.provider.providerId === providerId,
  )
}
