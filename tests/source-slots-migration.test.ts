import { describe, expect, it } from 'vitest'
import {
  migrateLegacyTemplateYaml,
  planProfileBindingMigration,
  planTemplateMigration,
} from '../worker/migrations/source-slots-migration'
import { parseTemplateYaml } from '../worker/templates/validator'
import { parseTemplateSourceSlots } from '../worker/templates/source-slots'

describe('migrateLegacyTemplateYaml', () => {
  const sampleLegacyYaml = `proxy-groups:
  - name: 节点选择
    type: select
    proxies:
      - __WANGWANG_CUSTOM_SOURCE_NODES__
      - DIRECT
rules:
  - MATCH,节点选择
`

  it('adds x-wangwang and replaces placeholder in valid legacy template', () => {
    const slotKey = '__WANGWANG_SOURCE_SLOT_abc123__'
    const result = migrateLegacyTemplateYaml(sampleLegacyYaml, slotKey)

    expect(result.slot).toEqual({
      key: slotKey,
      name: '默认节点源',
    })
    expect(result.yaml).toContain('x-wangwang:')
    expect(result.yaml).toContain(slotKey)
    expect(result.yaml).not.toContain('__WANGWANG_CUSTOM_SOURCE_NODES__')

    // Verifies transformed YAML passes new parseTemplateYaml
    const config = parseTemplateYaml(result.yaml)
    const slots = parseTemplateSourceSlots(config)
    expect(slots).toEqual([{ key: slotKey, name: '默认节点源' }])
  })

  it('replaces all repeated placeholder occurrences', () => {
    const multiGroupLegacyYaml = `proxy-groups:
  - name: 节点选择
    type: select
    proxies:
      - __WANGWANG_CUSTOM_SOURCE_NODES__
      - DIRECT
  - name: 自动选择
    type: url-test
    url: https://www.gstatic.com/generate_204
    interval: 300
    proxies:
      - __WANGWANG_CUSTOM_SOURCE_NODES__
rules:
  - MATCH,节点选择
`
    const slotKey = '__WANGWANG_SOURCE_SLOT_def456__'
    const result = migrateLegacyTemplateYaml(multiGroupLegacyYaml, slotKey)

    expect(result.yaml).not.toContain('__WANGWANG_CUSTOM_SOURCE_NODES__')
    const count = (result.yaml.match(new RegExp(slotKey, 'g')) || []).length
    // Once in x-wangwang.sources, and twice in proxy-groups
    expect(count).toBe(3)

    const config = parseTemplateYaml(result.yaml)
    const slots = parseTemplateSourceSlots(config)
    expect(slots).toHaveLength(1)
  })

  it('throws migration-required error when legacy template has no placeholder', () => {
    const noPlaceholderYaml = `proxy-groups:
  - name: 节点选择
    type: select
    proxies:
      - DIRECT
rules:
  - MATCH,节点选择
`
    expect(() => migrateLegacyTemplateYaml(noPlaceholderYaml, '__WANGWANG_SOURCE_SLOT_abc123__')).toThrow(
      /未包含旧版节点源占位符/,
    )
  })

  it('throws error when legacy template already has conflicting x-wangwang metadata', () => {
    const conflictingYaml = `x-wangwang:
  custom: true
proxy-groups:
  - name: 节点选择
    type: select
    proxies:
      - __WANGWANG_CUSTOM_SOURCE_NODES__
rules:
  - MATCH,节点选择
`
    expect(() => migrateLegacyTemplateYaml(conflictingYaml, '__WANGWANG_SOURCE_SLOT_abc123__')).toThrow(
      /已包含 x-wangwang 元数据/,
    )
  })
})

describe('planProfileBindingMigration', () => {
  it('maps built-in profile sources to fixed slot key', () => {
    const operations = planProfileBindingMigration({
      profiles: [
        { id: 'p1', templateId: 'builtin:minimal' },
        { id: 'p2', templateId: 'builtin:standard' },
      ],
      customTemplates: [],
      legacyProfileSources: [
        { profileId: 'p1', sourceId: 's1' },
        { profileId: 'p1', sourceId: 's2' },
        { profileId: 'p2', sourceId: 's3' },
      ],
      existingBindings: [],
    })

    expect(operations).toEqual([
      { profileId: 'p1', slotKey: '__WANGWANG_SOURCE_SLOT_mini01__', sourceId: 's1' },
      { profileId: 'p1', slotKey: '__WANGWANG_SOURCE_SLOT_mini01__', sourceId: 's2' },
      { profileId: 'p2', slotKey: '__WANGWANG_SOURCE_SLOT_std001__', sourceId: 's3' },
    ])
  })

  it('maps custom profile sources to custom template slot key', () => {
    const operations = planProfileBindingMigration({
      profiles: [{ id: 'p3', templateId: 'custom-tpl-1' }],
      customTemplates: [{ id: 'custom-tpl-1', slotKey: '__WANGWANG_SOURCE_SLOT_custom1__' }],
      legacyProfileSources: [{ profileId: 'p3', sourceId: 's1' }],
      existingBindings: [],
    })

    expect(operations).toEqual([{ profileId: 'p3', slotKey: '__WANGWANG_SOURCE_SLOT_custom1__', sourceId: 's1' }])
  })

  it('is idempotent and skips already existing bindings', () => {
    const operations = planProfileBindingMigration({
      profiles: [{ id: 'p1', templateId: 'builtin:minimal' }],
      customTemplates: [],
      legacyProfileSources: [
        { profileId: 'p1', sourceId: 's1' },
        { profileId: 'p1', sourceId: 's2' },
      ],
      existingBindings: [{ profileId: 'p1', slotKey: '__WANGWANG_SOURCE_SLOT_mini01__', sourceId: 's1' }],
    })

    expect(operations).toEqual([{ profileId: 'p1', slotKey: '__WANGWANG_SOURCE_SLOT_mini01__', sourceId: 's2' }])
  })
})

describe('planTemplateMigration', () => {
  it('plans migration for template with legacy placeholder', () => {
    const legacyYaml = `proxy-groups:
  - name: 节点选择
    type: select
    proxies:
      - __WANGWANG_CUSTOM_SOURCE_NODES__
rules:
  - MATCH,节点选择
`
    const plans = planTemplateMigration([{ id: 'tpl-1', yaml: legacyYaml }])
    expect(plans).toHaveLength(1)
    expect(plans[0].action).toBe('migrate')
    expect(plans[0].nextYaml).toContain('x-wangwang:')
    expect(plans[0].slotKey).toBeDefined()
  })

  it('plans needs_repair for legacy template without placeholder', () => {
    const noPlaceholderYaml = `proxy-groups:
  - name: 节点选择
    type: select
    proxies:
      - DIRECT
rules:
  - MATCH,节点选择
`
    const plans = planTemplateMigration([{ id: 'tpl-2', yaml: noPlaceholderYaml }])
    expect(plans).toHaveLength(1)
    expect(plans[0].action).toBe('needs_repair')
    expect(plans[0].error).toMatch(/模板必须包含 1 到 20 个节点源槽位|未包含旧版节点源占位符/)
  })

  it('plans noop for already migrated valid template', () => {
    const validYaml = `x-wangwang:
  sources:
    - key: __WANGWANG_SOURCE_SLOT_abc123__
      name: 节点源
proxy-groups:
  - name: 节点选择
    type: select
    proxies:
      - __WANGWANG_SOURCE_SLOT_abc123__
rules:
  - MATCH,节点选择
`
    const plans = planTemplateMigration([{ id: 'tpl-3', yaml: validYaml }])
    expect(plans).toHaveLength(1)
    expect(plans[0].action).toBe('noop')
    expect(plans[0].slotKey).toBe('__WANGWANG_SOURCE_SLOT_abc123__')
  })
})
