import { describe, expect, it } from 'vitest'
import type {
  GeoSettingsDraft,
  RuleDraft,
  RuleProviderDraft,
  RuleTargetDraft,
  VisualTemplateDraft,
} from '../src/features/templates/visual/model'
import { validateVisualDraft } from '../src/features/templates/visual/validation'

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

function draft(ruleList: RuleDraft[], providers: RuleProviderDraft[] = [provider('provider-a')]): VisualTemplateDraft {
  return { geo, groups: [], ruleProviders: providers, rules: ruleList }
}

function issuesFor(ruleList: RuleDraft[], providers?: RuleProviderDraft[]) {
  return validateVisualDraft(draft(ruleList, providers))
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
