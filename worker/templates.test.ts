import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { builtinTemplate } from './templates/builtin'
import { renderMihomoConfig } from './templates/renderer'
import { parseTemplateYaml } from './templates/validator'

const nodes = [
  { name: '香港', config: { name: '香港', type: 'ss', server: 'hk.example.com', port: 8388 } },
  { name: '香港', config: { name: '香港', type: 'ss', server: 'hk-2.example.com', port: 8388 } },
]

describe('订阅模板渲染', () => {
  it('注入节点并展开占位符，同时处理重名', () => {
    const yaml = renderMihomoConfig({ nodes, template: builtinTemplate('builtin:minimal')! })
    const config = parse(yaml) as Record<string, unknown>
    const groups = config['proxy-groups'] as Array<{ proxies: string[] }>

    expect((config.proxies as Array<{ name: string }>).map((proxy) => proxy.name)).toEqual(['香港', '香港-2'])
    expect(groups[0]?.proxies).toContain('香港-2')
    expect(yaml).not.toContain('__WANGWANG_ALL_PROXIES__')
  })

  it('拒绝根级节点和未知占位符', () => {
    expect(() => parseTemplateYaml('proxies: []\nproxy-groups: []')).toThrow('不能直接定义根级 proxies')
    expect(() =>
      parseTemplateYaml(`proxy-groups:\n  - name: 节点选择\n    type: select\n    proxies: [__WANGWANG_TAG_HK__]`),
    ).toThrow('占位符位置或名称无效')
  })
})
