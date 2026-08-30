import type { ProxyGroupDraft, VisualIssue, VisualTemplateDraft } from './model'

const URL_TYPES = new Set(['url-test', 'fallback', 'load-balance'])
const NO_RESOLVE_TYPES = new Set(['GEOIP', 'IP-CIDR', 'IP-CIDR6'])

export function validateVisualDraft(draft: VisualTemplateDraft, initial: VisualIssue[] = []) {
  const issues = [...initial]
  const add = (issue: VisualIssue) => {
    if (
      !issues.some(
        (item) =>
          item.code === issue.code &&
          item.groupId === issue.groupId &&
          item.ruleId === issue.ruleId &&
          item.message === issue.message,
      )
    )
      issues.push(issue)
  }
  const names = new Map<string, ProxyGroupDraft[]>()
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
  draft.groups.forEach((group) => names.set(group.name, [...(names.get(group.name) || []), group]))
  draft.groups.forEach((group) => {
    if (!group.name.trim())
      add({ level: 'error', code: 'GROUP_NAME_EMPTY', message: '代理组名称不能为空', groupId: group.id })
    if ((names.get(group.name) || []).length > 1)
      add({ level: 'error', code: 'GROUP_NAME_DUPLICATE', message: `代理组名称重复：${group.name}`, groupId: group.id })
    if (group.kind === 'raw') {
      add({ level: 'warning', code: 'RAW_GROUP', message: `代理组“${group.name}”仅支持 YAML 编辑`, groupId: group.id })
      return
    }
    if (!group.members.length)
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
    for (const member of group.members)
      if (member.kind === 'group' && !draft.groups.some((item) => item.id === member.groupId))
        add({
          level: 'error',
          code: 'GROUP_MEMBER_MISSING',
          message: `代理组“${group.name}”引用了不存在的代理组`,
          groupId: group.id,
        })
  }
  draft.rules.forEach((rule, index) => {
    if (rule.kind === 'raw') {
      add({ level: 'warning', code: 'RAW_RULE', message: '存在仅支持 YAML 编辑的高级规则', ruleId: rule.id })
      return
    }
    if (rule.type !== 'MATCH' && !rule.value?.trim())
      add({
        level: 'error',
        code: 'RULE_VALUE_EMPTY',
        message: `第 ${index + 1} 条规则的匹配值不能为空`,
        ruleId: rule.id,
      })
    if (rule.target.kind === 'group') {
      const targetGroupId = rule.target.groupId
      if (!draft.groups.some((group) => group.id === targetGroupId))
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
    if (rule.noResolve && !NO_RESOLVE_TYPES.has(rule.type))
      add({
        level: 'error',
        code: 'RULE_NO_RESOLVE_INVALID',
        message: `${rule.type} 不支持 no-resolve`,
        ruleId: rule.id,
      })
  })
  const matchIndexes = draft.rules.flatMap((rule, index) =>
    rule.kind === 'structured' && rule.type === 'MATCH' ? [index] : [],
  )
  if (matchIndexes.length > 1) add({ level: 'error', code: 'MULTIPLE_MATCH', message: '存在多个 MATCH 兜底规则' })
  if (matchIndexes.some((index) => index !== draft.rules.length - 1))
    add({ level: 'warning', code: 'MATCH_NOT_LAST', message: 'MATCH 规则不在最后' })
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
      const cycle = [...path.slice(path.indexOf(id)), id].map(
        (item) => draft.groups.find((group) => group.id === item)?.name || item,
      )
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
  }
}
