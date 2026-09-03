import { describe, expect, it } from 'vitest'
import { parseTemplateYaml } from '../worker/templates/validator'
import {
  generateSourceSlotKey,
  parseTemplateSourceSlots,
  SOURCE_SLOT_KEY_PATTERN,
} from '../worker/templates/source-slots'

const slotA = '__WANGWANG_SOURCE_SLOT_a8f3k2__'
const slotB = '__WANGWANG_SOURCE_SLOT_p7m4x1__'

function yamlWith(slots: string, proxies: string, extra = '') {
  return `x-wangwang:
  sources:
${slots}
proxy-groups:
  - name: test
    type: select
    proxies:
${proxies}
rules:
  - MATCH,test
${extra}`
}

describe('source-slots metadata & validation', () => {
  it('验证有效的多槽位模板', () => {
    const yaml = yamlWith(
      `    - key: ${slotA}
      name: 主力节点
    - key: ${slotB}
      name: 备用节点`,
      `      - ${slotA}
      - ${slotB}`,
    )
    const config = parseTemplateYaml(yaml)
    const slots = parseTemplateSourceSlots(config)
    expect(slots).toEqual([
      { key: slotA, name: '主力节点' },
      { key: slotB, name: '备用节点' },
    ])
  })

  it('拒绝缺少 x-wangwang.sources 或槽位数量为 0', () => {
    const yaml = `proxy-groups:
  - name: test
    type: select
    proxies:
      - DIRECT
rules:
  - MATCH,test
`
    expect(() => parseTemplateYaml(yaml)).toThrow('模板必须包含 1 到 20 个节点源槽位')
  })

  it('拒绝超过 20 个槽位', () => {
    const slotList = Array.from({ length: 21 }, (_, i) => {
      const suffix = i.toString().padStart(6, '0')
      return `    - key: __WANGWANG_SOURCE_SLOT_${suffix}__\n      name: 节点源${i}`
    }).join('\n')
    const proxiesList = Array.from({ length: 21 }, (_, i) => {
      const suffix = i.toString().padStart(6, '0')
      return `      - __WANGWANG_SOURCE_SLOT_${suffix}__`
    }).join('\n')

    const yaml = yamlWith(slotList, proxiesList)
    expect(() => parseTemplateYaml(yaml)).toThrow('模板节点源槽位数量不能超过 20 个')
  })

  it('拒绝格式非法的槽位 key', () => {
    const yaml = yamlWith(
      `    - key: __WANGWANG_SOURCE_SLOT_invalid__
      name: 测试`,
      `      - __WANGWANG_SOURCE_SLOT_invalid__`,
    )
    expect(() => parseTemplateYaml(yaml)).toThrow('节点源槽位 key 格式无效')
  })

  it('拒绝重复的槽位 key', () => {
    const yaml = yamlWith(
      `    - key: ${slotA}
      name: 主力节点
    - key: ${slotA}
      name: 备用节点`,
      `      - ${slotA}`,
    )
    expect(() => parseTemplateYaml(yaml)).toThrow(`节点源槽位 key 重复：${slotA}`)
  })

  it('拒绝 trim 后重复的槽位名称', () => {
    const yaml = yamlWith(
      `    - key: ${slotA}
      name: '主力节点 '
    - key: ${slotB}
      name: ' 主力节点'`,
      `      - ${slotA}
      - ${slotB}`,
    )
    expect(() => parseTemplateYaml(yaml)).toThrow('节点源槽位名称重复：主力节点')
  })

  it('拒绝槽位名称为空或超过 40 个字符', () => {
    const yamlEmpty = yamlWith(
      `    - key: ${slotA}
      name: '   '`,
      `      - ${slotA}`,
    )
    expect(() => parseTemplateYaml(yamlEmpty)).toThrow('节点源槽位名称不能为空')

    const yamlLong = yamlWith(
      `    - key: ${slotA}
      name: '${'a'.repeat(41)}'`,
      `      - ${slotA}`,
    )
    expect(() => parseTemplateYaml(yamlLong)).toThrow('节点源槽位名称不能超过 40 个字符')
  })

  it('拒绝 x-wangwang 中包含未知字段', () => {
    const yaml = `x-wangwang:
  sources:
    - key: ${slotA}
      name: 主力节点
  unknown_field: 123
proxy-groups:
  - name: test
    type: select
    proxies:
      - ${slotA}
rules:
  - MATCH,test
`
    expect(() => parseTemplateYaml(yaml)).toThrow('x-wangwang 包含未知字段：unknown_field')
  })

  it('拒绝代理组引用未声明的槽位', () => {
    const yaml = yamlWith(
      `    - key: ${slotA}
      name: 主力节点`,
      `      - ${slotA}
      - ${slotB}`,
    )
    expect(() => parseTemplateYaml(yaml)).toThrow(`代理组“test”引用了未声明的节点源槽位：${slotB}`)
  })

  it('拒绝声明了但未被任何代理组引用的槽位', () => {
    const yaml = yamlWith(
      `    - key: ${slotA}
      name: 主力节点
    - key: ${slotB}
      name: 备用节点`,
      `      - ${slotA}`,
    )
    expect(() => parseTemplateYaml(yaml)).toThrow(`节点源槽位未被任何代理组引用：${slotB}（备用节点）`)
  })

  it('拒绝遗留占位符 __WANGWANG_CUSTOM_SOURCE_NODES__', () => {
    const yaml = yamlWith(
      `    - key: ${slotA}
      name: 主力节点`,
      `      - ${slotA}
      - __WANGWANG_CUSTOM_SOURCE_NODES__`,
    )
    expect(() => parseTemplateYaml(yaml)).toThrow('占位符位置或名称无效：__WANGWANG_CUSTOM_SOURCE_NODES__')
  })

  it('拒绝未知的 __WANGWANG_*__ 占位符', () => {
    const yaml = yamlWith(
      `    - key: ${slotA}
      name: 主力节点`,
      `      - ${slotA}
      - __WANGWANG_UNKNOWN_FOO__`,
    )
    expect(() => parseTemplateYaml(yaml)).toThrow('占位符位置或名称无效：__WANGWANG_UNKNOWN_FOO__')
  })

  it('generateSourceSlotKey 生成符合规则且不与现有冲突的 key', () => {
    const existing = new Set<string>()
    for (let i = 0; i < 50; i++) {
      const key = generateSourceSlotKey(existing)
      expect(key).toMatch(SOURCE_SLOT_KEY_PATTERN)
      expect(existing.has(key)).toBe(false)
      existing.add(key)
    }
  })
})

import { builtinTemplates } from '../worker/templates/builtin'

describe('内置模板验证', () => {
  it('所有内置模板均能通过解析校验且槽位合法', () => {
    for (const t of builtinTemplates) {
      const config = parseTemplateYaml(t.yaml)
      const slots = parseTemplateSourceSlots(config)
      expect(slots.length).toBeGreaterThanOrEqual(1)
      expect(slots.length).toBeLessThanOrEqual(20)
    }
  })
})
