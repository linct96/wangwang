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
  - name: 高级
    type: load-balance
    strategy: consistent-hashing
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
    const next = {
      ...result.draft,
      groups: result.draft.groups.map((group) => (group.id === first.id ? { ...group, name: '默认代理' } : group)),
    }
    const output = applyVisualTemplate(source, next)
    const parsed = parseDocument(output).toJS() as Record<string, any>
    expect(parsed['mixed-port']).toBe(7890)
    expect(parsed['custom-root'].keep).toBe(true)
    expect(parsed['proxy-groups'][0].foo).toBe('bar')
    expect(parsed['proxy-groups'][1].proxies[0]).toBe('节点选择')
    expect(parsed['proxy-groups'][2].proxies[0]).toBe('默认代理')
    expect(parsed.rules[0]).toContain('AND,')
    expect(findPotentialRawReferences(result.draft, '节点选择').count).toBe(1)
  })
})
