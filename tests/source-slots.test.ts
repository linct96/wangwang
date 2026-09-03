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

import { renderMihomoConfig, type SelectedSlotNode } from '../worker/templates/renderer'
import { parse } from 'yaml'

describe('slot-aware renderer', () => {
  const slot1 = '__WANGWANG_SOURCE_SLOT_slot01__'
  const slot2 = '__WANGWANG_SOURCE_SLOT_slot02__'

  const baseTemplateYaml = `x-wangwang:
  sources:
    - key: ${slot1}
      name: 主力源
    - key: ${slot2}
      name: 备用源
proxy-groups:
  - name: 🚀 主力组
    type: select
    proxies:
      - ${slot1}
  - name: 🛡️ 备用组
    type: select
    proxies:
      - ${slot2}
  - name: 🔀 联合组
    type: select
    proxies:
      - DIRECT
      - ${slot1}
      - ${slot2}
rules:
  - MATCH,DIRECT
`

  const dummyProxy = {
    type: 'ss',
    server: '1.1.1.1',
    port: 8388,
  }

  it('单槽位仅展开自身绑定的节点', () => {
    const nodes: SelectedSlotNode[] = [
      { slotKey: slot1, entryId: 'e1', sourceId: 's1', name: 'Node-A', config: { ...dummyProxy, name: 'Node-A' } },
      { slotKey: slot2, entryId: 'e2', sourceId: 's2', name: 'Node-B', config: { ...dummyProxy, name: 'Node-B' } },
    ]
    const rendered = renderMihomoConfig({ template: { yaml: baseTemplateYaml }, nodes })
    const parsed = parse(rendered) as any

    const group1 = parsed['proxy-groups'].find((g: any) => g.name === '🚀 主力组')
    expect(group1.proxies).toEqual(['Node-A'])

    const group2 = parsed['proxy-groups'].find((g: any) => g.name === '🛡️ 备用组')
    expect(group2.proxies).toEqual(['Node-B'])
  })

  it('同代理组包含两个槽位时按成员声明顺序展开', () => {
    const nodes: SelectedSlotNode[] = [
      { slotKey: slot1, entryId: 'e1', sourceId: 's1', name: 'Node-A', config: { ...dummyProxy, name: 'Node-A' } },
      { slotKey: slot2, entryId: 'e2', sourceId: 's2', name: 'Node-B', config: { ...dummyProxy, name: 'Node-B' } },
    ]
    const rendered = renderMihomoConfig({ template: { yaml: baseTemplateYaml }, nodes })
    const parsed = parse(rendered) as any

    const groupUnion = parsed['proxy-groups'].find((g: any) => g.name === '🔀 联合组')
    expect(groupUnion.proxies).toEqual(['DIRECT', 'Node-A', 'Node-B'])
  })

  it('相同 entryId 在多个槽位中仅生成一个根节点并可在各组引用', () => {
    const nodes: SelectedSlotNode[] = [
      {
        slotKey: slot1,
        entryId: 'e1',
        sourceId: 's1',
        name: 'Shared-Node',
        config: { ...dummyProxy, name: 'Shared-Node' },
      },
      {
        slotKey: slot2,
        entryId: 'e1',
        sourceId: 's1',
        name: 'Shared-Node',
        config: { ...dummyProxy, name: 'Shared-Node' },
      },
    ]
    const rendered = renderMihomoConfig({ template: { yaml: baseTemplateYaml }, nodes })
    const parsed = parse(rendered) as any

    expect(parsed.proxies).toHaveLength(1)
    expect(parsed.proxies[0].name).toBe('Shared-Node')

    const g1 = parsed['proxy-groups'].find((g: any) => g.name === '🚀 主力组')
    const g2 = parsed['proxy-groups'].find((g: any) => g.name === '🛡️ 备用组')
    expect(g1.proxies).toEqual(['Shared-Node'])
    expect(g2.proxies).toEqual(['Shared-Node'])
  })

  it('同组引用重叠槽位时稳定去重', () => {
    const nodes: SelectedSlotNode[] = [
      {
        slotKey: slot1,
        entryId: 'e1',
        sourceId: 's1',
        name: 'Shared-Node',
        config: { ...dummyProxy, name: 'Shared-Node' },
      },
      {
        slotKey: slot2,
        entryId: 'e1',
        sourceId: 's1',
        name: 'Shared-Node',
        config: { ...dummyProxy, name: 'Shared-Node' },
      },
      {
        slotKey: slot2,
        entryId: 'e2',
        sourceId: 's2',
        name: 'Unique-Node',
        config: { ...dummyProxy, name: 'Unique-Node' },
      },
    ]
    const rendered = renderMihomoConfig({ template: { yaml: baseTemplateYaml }, nodes })
    const parsed = parse(rendered) as any

    const g = parsed['proxy-groups'].find((g: any) => g.name === '🔀 联合组')
    expect(g.proxies).toEqual(['DIRECT', 'Shared-Node', 'Unique-Node'])
  })

  it('不同 entryId 但同名时生成 name, name-2 且在所有槽位中一致', () => {
    const nodes: SelectedSlotNode[] = [
      { slotKey: slot1, entryId: 'e1', sourceId: 's1', name: 'HongKong', config: { ...dummyProxy, server: '1.1.1.1' } },
      { slotKey: slot2, entryId: 'e2', sourceId: 's2', name: 'HongKong', config: { ...dummyProxy, server: '2.2.2.2' } },
    ]
    const rendered = renderMihomoConfig({ template: { yaml: baseTemplateYaml }, nodes })
    const parsed = parse(rendered) as any

    expect(parsed.proxies.map((p: any) => p.name)).toEqual(['HongKong', 'HongKong-2'])
    const g1 = parsed['proxy-groups'].find((g: any) => g.name === '🚀 主力组')
    const g2 = parsed['proxy-groups'].find((g: any) => g.name === '🛡️ 备用组')
    expect(g1.proxies).toEqual(['HongKong'])
    expect(g2.proxies).toEqual(['HongKong-2'])
  })

  it('filter 和 exclude-filter 仅作用于槽位展开节点', () => {
    const yamlWithFilter = `x-wangwang:
  sources:
    - key: ${slot1}
      name: 主力源
proxy-groups:
  - name: 过滤组
    type: select
    filter: '(?i)HK'
    exclude-filter: 'BGP'
    proxies:
      - DIRECT
      - ${slot1}
rules:
  - MATCH,DIRECT
`
    const nodes: SelectedSlotNode[] = [
      { slotKey: slot1, entryId: 'e1', sourceId: 's1', name: 'HK 01', config: dummyProxy },
      { slotKey: slot1, entryId: 'e2', sourceId: 's1', name: 'HK BGP 02', config: dummyProxy },
      { slotKey: slot1, entryId: 'e3', sourceId: 's1', name: 'US 01', config: dummyProxy },
    ]
    const rendered = renderMihomoConfig({ template: { yaml: yamlWithFilter }, nodes })
    const parsed = parse(rendered) as any

    const g = parsed['proxy-groups'].find((g: any) => g.name === '过滤组')
    expect(g.proxies).toEqual(['DIRECT', 'HK 01'])
  })

  it('过滤后组为空不会导致渲染失败', () => {
    const yamlFilterAll = `x-wangwang:
  sources:
    - key: ${slot1}
      name: 主力源
proxy-groups:
  - name: 空组
    type: select
    filter: 'NoneMatch'
    proxies:
      - ${slot1}
rules:
  - MATCH,DIRECT
`
    const nodes: SelectedSlotNode[] = [
      { slotKey: slot1, entryId: 'e1', sourceId: 's1', name: 'HK 01', config: dummyProxy },
    ]
    const rendered = renderMihomoConfig({ template: { yaml: yamlFilterAll }, nodes })
    const parsed = parse(rendered) as any
    const g = parsed['proxy-groups'].find((g: any) => g.name === '空组')
    expect(g.proxies).toEqual([])
  })

  it('输出 YAML 既不包含 x-wangwang 也不包含任何 __WANGWANG_ 占位符', () => {
    const nodes: SelectedSlotNode[] = [
      { slotKey: slot1, entryId: 'e1', sourceId: 's1', name: 'Node-1', config: dummyProxy },
      { slotKey: slot2, entryId: 'e2', sourceId: 's2', name: 'Node-2', config: dummyProxy },
    ]
    const rendered = renderMihomoConfig({ template: { yaml: baseTemplateYaml }, nodes })
    expect(rendered).not.toContain('x-wangwang')
    expect(rendered).not.toContain('__WANGWANG_')
  })
})

import { sameSourceSlotStructure } from '../worker/templates/source-slots'

describe('sameSourceSlotStructure', () => {
  const slotA = '__WANGWANG_SOURCE_SLOT_slot01__'
  const slotB = '__WANGWANG_SOURCE_SLOT_slot02__'
  const slotC = '__WANGWANG_SOURCE_SLOT_slot03__'

  const templateBase = (slots: string, proxies: string) => `x-wangwang:
  sources:
${slots}
proxy-groups:
  - name: test
    type: select
    proxies:
${proxies}
rules:
  - MATCH,test
`

  const originalYaml = templateBase(
    `    - key: ${slotA}\n      name: 主力\n    - key: ${slotB}\n      name: 备用`,
    `      - ${slotA}\n      - ${slotB}`,
  )

  it('仅重命名槽位时视为相同结构', () => {
    const renamedYaml = templateBase(
      `    - key: ${slotA}\n      name: 主力新名称\n    - key: ${slotB}\n      name: 备用新名称`,
      `      - ${slotA}\n      - ${slotB}`,
    )
    expect(sameSourceSlotStructure(originalYaml, renamedYaml)).toBe(true)
  })

  it('仅重排序槽位时视为相同结构', () => {
    const reorderedYaml = templateBase(
      `    - key: ${slotB}\n      name: 备用\n    - key: ${slotA}\n      name: 主力`,
      `      - ${slotA}\n      - ${slotB}`,
    )
    expect(sameSourceSlotStructure(originalYaml, reorderedYaml)).toBe(true)
  })

  it('新增槽位时视为结构改变', () => {
    const addedYaml = templateBase(
      `    - key: ${slotA}\n      name: 主力\n    - key: ${slotB}\n      name: 备用\n    - key: ${slotC}\n      name: 额外`,
      `      - ${slotA}\n      - ${slotB}\n      - ${slotC}`,
    )
    expect(sameSourceSlotStructure(originalYaml, addedYaml)).toBe(false)
  })

  it('删除槽位时视为结构改变', () => {
    const deletedYaml = templateBase(`    - key: ${slotA}\n      name: 主力`, `      - ${slotA}`)
    expect(sameSourceSlotStructure(originalYaml, deletedYaml)).toBe(false)
  })

  it('更换槽位 key 时视为结构改变', () => {
    const keyChangedYaml = templateBase(
      `    - key: ${slotA}\n      name: 主力\n    - key: ${slotC}\n      name: 备用`,
      `      - ${slotA}\n      - ${slotC}`,
    )
    expect(sameSourceSlotStructure(originalYaml, keyChangedYaml)).toBe(false)
  })
})
