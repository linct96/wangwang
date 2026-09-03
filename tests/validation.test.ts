import { describe, expect, it } from 'vitest'
import type {
  GeoSettingsDraft,
  RuleDraft,
  RuleProviderDraft,
  RuleTargetDraft,
  VisualTemplateDraft,
} from '../src/features/templates/visual/model'
import { validateVisualDraft } from '../src/features/templates/visual/validation'
import { createBlankTemplate } from '../src/features/templates/blank'
import { parseVisualTemplate } from '../src/features/templates/visual/yaml-adapter'

const geo: GeoSettingsDraft = { geoxUrl: {} }

function provider(id: string, behavior: 'domain' | 'ipcidr' = 'domain'): RuleProviderDraft {
  return {
    kind: 'structured',
    id,
    name: id,
    type: 'inline',
    behavior,
    payload: behavior === 'ipcidr' ? ['198.51.100.1/32'] : ['example.com'],
    extras: {},
  }
}

function target(value: 'DIRECT' | 'REJECT'): RuleTargetDraft {
  return { kind: 'builtin', value }
}

function rule(
  id: string,
  providerId: string,
  targetValue: 'DIRECT' | 'REJECT' = 'DIRECT',
  noResolve = false,
): RuleDraft {
  return ruleWithTarget(id, providerId, target(targetValue), noResolve)
}

function ruleWithTarget(id: string, providerId: string, ruleTarget: RuleTargetDraft, noResolve = false): RuleDraft {
  return {
    kind: 'structured',
    id,
    type: 'RULE-SET',
    provider: { kind: 'provider', providerId },
    target: ruleTarget,
    noResolve,
  }
}

const defaultSlotKey = '__WANGWANG_SOURCE_SLOT_main01__'
const defaultSlots = [{ key: defaultSlotKey, name: '主力节点' }]
const defaultGroups: VisualTemplateDraft['groups'] = [
  {
    kind: 'structured',
    id: 'g1',
    name: '默认组',
    type: 'select',
    members: [{ kind: 'source-slot', slotKey: defaultSlotKey }],
    extras: {},
  },
]

function draft(
  ruleList: RuleDraft[],
  providers: RuleProviderDraft[] = [provider('provider-a')],
  sourceSlots = defaultSlots,
  groups = defaultGroups,
): VisualTemplateDraft {
  return { geo, sourceSlots, groups, ruleProviders: providers, rules: ruleList }
}

function issuesFor(
  ruleList: RuleDraft[],
  providers?: RuleProviderDraft[],
  sourceSlots?: VisualTemplateDraft['sourceSlots'],
  groups?: VisualTemplateDraft['groups'],
) {
  return validateVisualDraft(draft(ruleList, providers, sourceSlots, groups))
}

function codesFor(issues: ReturnType<typeof validateVisualDraft>, ruleId: string) {
  return issues.filter((issue) => issue.ruleId === ruleId).map((issue) => issue.code)
}

describe('RULE-SET 引用校验', () => {
  it('同 provider、同 target、同 no-resolve 时标记后置重复规则', () => {
    const issues = issuesFor([rule('rule-1', 'provider-a'), rule('rule-2', 'provider-a')])

    expect(codesFor(issues, 'rule-2')).toContain('RULE_SET_RULE_DUPLICATE')
    expect(issues.some((issue) => issue.code === 'RULE_SET_PROVIDER_DUPLICATE')).toBe(false)
  })

  it('同 provider、不同 target 时标记后置遮蔽规则', () => {
    const issues = issuesFor([rule('rule-1', 'provider-a', 'DIRECT'), rule('rule-2', 'provider-a', 'REJECT')])

    expect(codesFor(issues, 'rule-2')).toContain('RULE_SET_RULE_SHADOWED')
  })

  it('不同 provider 不产生重复或遮蔽错误', () => {
    const issues = issuesFor(
      [rule('rule-1', 'provider-a'), rule('rule-2', 'provider-b')],
      [provider('provider-a'), provider('provider-b')],
    )

    expect(issues.some((issue) => issue.code.startsWith('RULE_SET_RULE_'))).toBe(false)
  })

  it('同 provider 的 IP 规则且 no-resolve 相同时按普通重复逻辑处理', () => {
    const issues = issuesFor(
      [rule('rule-1', 'provider-ip', 'DIRECT', true), rule('rule-2', 'provider-ip', 'DIRECT', true)],
      [provider('provider-ip', 'ipcidr')],
    )

    expect(codesFor(issues, 'rule-2')).toContain('RULE_SET_RULE_DUPLICATE')
    expect(codesFor(issues, 'rule-2')).not.toContain('RULE_SET_NO_RESOLVE_OVERLAP')
  })

  it('同 provider 的 IP 规则 no-resolve 不同时只标记 overlap warning', () => {
    const issues = issuesFor(
      [rule('rule-1', 'provider-ip', 'DIRECT', true), rule('rule-2', 'provider-ip', 'DIRECT', false)],
      [provider('provider-ip', 'ipcidr')],
    )

    expect(codesFor(issues, 'rule-2')).toContain('RULE_SET_NO_RESOLVE_OVERLAP')
    expect(codesFor(issues, 'rule-2')).not.toContain('RULE_SET_RULE_DUPLICATE')
    expect(codesFor(issues, 'rule-2')).not.toContain('RULE_SET_RULE_SHADOWED')
  })

  it('domain provider 使用 no-resolve 继续报合法性错误', () => {
    const issues = issuesFor([rule('rule-1', 'provider-a', 'DIRECT', true)])

    expect(codesFor(issues, 'rule-1')).toContain('RULE_SET_NO_RESOLVE_INVALID')
  })

  it('RAW 高级规则不参与结构化 RULE-SET 重复分析', () => {
    const issues = issuesFor([
      {
        kind: 'raw',
        id: 'raw-rule-1',
        raw: 'AND,((RULE-SET,provider-a),(DST-PORT,443)),DIRECT',
      },
      rule('rule-1', 'provider-a'),
    ])

    expect(issues.some((issue) => issue.code === 'RULE_SET_RULE_DUPLICATE')).toBe(false)
    expect(issues.some((issue) => issue.code === 'RULE_SET_RULE_SHADOWED')).toBe(false)
  })

  it('provider 仅引用一次时不产生引用冲突问题', () => {
    const issues = issuesFor([rule('rule-1', 'provider-a')])

    expect(issues.some((issue) => issue.code.startsWith('RULE_SET_RULE_'))).toBe(false)
    expect(issues.some((issue) => issue.code === 'RULE_PROVIDER_UNUSED')).toBe(false)
  })

  it('provider 未被引用时保留 unused warning', () => {
    const issues = issuesFor([], [provider('provider-a')])

    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'RULE_PROVIDER_UNUSED', providerId: 'provider-a', level: 'warning' }),
    )
  })

  it('三条及以上规则按顺序定位重复和遮蔽的后置规则', () => {
    const issues = issuesFor([
      rule('rule-1', 'provider-a', 'DIRECT'),
      rule('rule-2', 'provider-a', 'REJECT'),
      rule('rule-3', 'provider-a', 'DIRECT'),
      ruleWithTarget('rule-4', 'provider-a', { kind: 'raw', value: 'PROXY-C' }),
    ])

    expect(codesFor(issues, 'rule-1')).not.toContain('RULE_SET_RULE_DUPLICATE')
    expect(codesFor(issues, 'rule-2')).toContain('RULE_SET_RULE_SHADOWED')
    expect(codesFor(issues, 'rule-3')).toContain('RULE_SET_RULE_DUPLICATE')
    expect(codesFor(issues, 'rule-4')).toContain('RULE_SET_RULE_SHADOWED')
    expect(issues.every((issue) => issue.code !== 'RULE_SET_PROVIDER_DUPLICATE')).toBe(true)
  })
})

describe('节点源槽位可视化校验', () => {
  it('槽位数量为 0 时报错', () => {
    const issues = issuesFor([], undefined, [])
    expect(issues.some((i) => i.code === 'SLOT_COUNT_EMPTY')).toBe(true)
  })

  it('槽位名称重复时报错', () => {
    const slotA = '__WANGWANG_SOURCE_SLOT_slot01__'
    const slotB = '__WANGWANG_SOURCE_SLOT_slot02__'
    const slots = [
      { key: slotA, name: '重复名称' },
      { key: slotB, name: '  重复名称  ' },
    ]
    const groups: VisualTemplateDraft['groups'] = [
      {
        kind: 'structured',
        id: 'g1',
        name: '组1',
        type: 'select',
        members: [
          { kind: 'source-slot', slotKey: slotA },
          { kind: 'source-slot', slotKey: slotB },
        ],
        extras: {},
      },
    ]
    const issues = issuesFor([], undefined, slots, groups)
    expect(issues.some((i) => i.code === 'SLOT_NAME_DUPLICATE')).toBe(true)
  })

  it('槽位 key 格式非法时报错', () => {
    const badSlot = { key: 'invalid-key', name: '有效名称' }
    const groups: VisualTemplateDraft['groups'] = [
      {
        kind: 'structured',
        id: 'g1',
        name: '组1',
        type: 'select',
        members: [{ kind: 'source-slot', slotKey: 'invalid-key' }],
        extras: {},
      },
    ]
    const issues = issuesFor([], undefined, [badSlot], groups)
    expect(issues.some((i) => i.code === 'SLOT_KEY_INVALID')).toBe(true)
  })

  it('未被任何代理组引用的槽位报错', () => {
    const slotA = '__WANGWANG_SOURCE_SLOT_slot01__'
    const slotB = '__WANGWANG_SOURCE_SLOT_slot02__'
    const slots = [
      { key: slotA, name: '已引用' },
      { key: slotB, name: '未引用' },
    ]
    const groups: VisualTemplateDraft['groups'] = [
      {
        kind: 'structured',
        id: 'g1',
        name: '组1',
        type: 'select',
        members: [{ kind: 'source-slot', slotKey: slotA }],
        extras: {},
      },
    ]
    const issues = issuesFor([], undefined, slots, groups)
    expect(issues.some((i) => i.code === 'SLOT_UNUSED' && i.slotKey === slotB)).toBe(true)
  })

  it('代理组成员引用未声明的槽位时报错', () => {
    const slotA = '__WANGWANG_SOURCE_SLOT_slot01__'
    const missingSlot = '__WANGWANG_SOURCE_SLOT_miss01__'
    const slots = [{ key: slotA, name: '已声明' }]
    const groups: VisualTemplateDraft['groups'] = [
      {
        kind: 'structured',
        id: 'g1',
        name: '组1',
        type: 'select',
        members: [{ kind: 'source-slot', slotKey: missingSlot }],
        extras: {},
      },
    ]
    const issues = issuesFor([], undefined, slots, groups)
    expect(issues.some((i) => i.code === 'GROUP_SLOT_MISSING')).toBe(true)
  })

  it('有效节点源槽位和成员引用时校验通过', () => {
    const slotA = '__WANGWANG_SOURCE_SLOT_slot01__'
    const slots = [{ key: slotA, name: '主节点源' }]
    const groups: VisualTemplateDraft['groups'] = [
      {
        kind: 'structured',
        id: 'g1',
        name: '组1',
        type: 'select',
        members: [{ kind: 'source-slot', slotKey: slotA }],
        extras: {},
      },
    ]
    const issues = issuesFor([], undefined, slots, groups)
    const errors = issues.filter((i) => i.level === 'error')
    expect(errors).toHaveLength(0)
  })
})

describe('createBlankTemplate', () => {
  it('generates unique nanoid(6) slot keys on each invocation and parses cleanly', () => {
    const tpl1 = createBlankTemplate()
    const tpl2 = createBlankTemplate()
    expect(tpl1).not.toEqual(tpl2)
    const result1 = parseVisualTemplate(tpl1)
    const result2 = parseVisualTemplate(tpl2)
    expect(result1.draft.sourceSlots).toHaveLength(1)
    expect(result2.draft.sourceSlots).toHaveLength(1)
    expect(result1.draft.sourceSlots[0].key).not.toEqual(result2.draft.sourceSlots[0].key)
    expect(result1.draft.sourceSlots[0].key).toMatch(/^__WANGWANG_SOURCE_SLOT_[A-Za-z0-9_-]{6}__$/)
  })
})
