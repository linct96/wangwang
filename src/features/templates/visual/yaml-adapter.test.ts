import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'
import { applyVisualTemplate, findPotentialRawReferences, parseVisualTemplate } from './yaml-adapter'

const source = `mixed-port: 7890
custom-root:
  keep: true
proxy-groups:
  - name: 节点选择
    type: select
    foo: bar
    proxies: [__WANGWANG_ALL_PROXIES__, DIRECT]
  - name: 均衡组
    type: load-balance
    strategy: round-robin
    url: https://www.gstatic.com/generate_204
    interval: 300
    proxies: [节点选择]
  - name: 高级
    type: relay
    proxies: [节点选择]
  - name: 二级
    type: select
    proxies: [节点选择]
rules:
  - AND,((NETWORK,UDP),(DST-PORT,443)),REJECT
  - MATCH,节点选择
`

describe('visual yaml adapter', () => {
  it('保留未知根字段、extras、RAW，并能更新结构化引用', () => {
    const result = parseVisualTemplate(source)
    const first = result.draft.groups[0]
    if (first.kind !== 'structured') throw new Error('expected structured group')
    const balance = result.draft.groups[1]
    if (balance.kind !== 'structured') throw new Error('expected load-balance to be structured')
    expect(balance.type).toBe('load-balance')
    expect(balance.strategy).toBe('round-robin')

    const next = {
      ...result.draft,
      groups: result.draft.groups.map((group) => (group.id === first.id ? { ...group, name: '默认代理' } : group)),
    }
    const output = applyVisualTemplate(source, next)
    const parsed = parseDocument(output).toJS() as Record<string, any>
    expect(parsed['mixed-port']).toBe(7890)
    expect(parsed['custom-root'].keep).toBe(true)
    expect(parsed['proxy-groups'][0].foo).toBe('bar')
    expect(parsed['proxy-groups'][1].strategy).toBe('round-robin')
    expect(parsed['proxy-groups'][1].proxies[0]).toBe('默认代理')
    expect(parsed['proxy-groups'][2].proxies[0]).toBe('节点选择')
    expect(parsed['proxy-groups'][3].proxies[0]).toBe('默认代理')
    expect(parsed.rules[0]).toContain('AND,')
    expect(findPotentialRawReferences(result.draft, '节点选择').count).toBe(1)
  })
})
