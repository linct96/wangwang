import { describe, expect, it } from 'vitest'
import { parse, stringify } from 'yaml'
import { parseProxyText } from '../worker/proxy'
import { builtinTemplates } from '../worker/templates/builtin'
import { renderMihomoConfig, type SelectedNode } from '../worker/templates/renderer'
import { slotProviderName, type TemplateSourceSlot } from '../shared/source-slots'
import { applyVisualTemplate, parseVisualTemplate } from '../src/features/templates/visual/yaml-adapter'
import { validateVisualDraft } from '../src/features/templates/visual/validation'

const uri = 'trojan://demo-password@proxy.example.com:443?security=tls#Demo'
const proxy = { name: 'Demo', type: 'trojan', server: 'proxy.example.com', port: 443, password: 'demo-password' }
const node: SelectedNode = {
  nodeId: 'node-demo',
  physicalNodeId: 'physical-demo',
  name: proxy.name,
  config: { type: proxy.type, server: proxy.server, port: proxy.port, password: proxy.password },
}

describe('订阅导入', () => {
  it.each([
    ['URI', uri],
    ['Base64', btoa(uri)],
    ['YAML', stringify({ proxies: [proxy] })],
  ])('导入 %s 订阅得到可用节点', async (_format, text) => {
    const result = await parseProxyText(text)

    expect(result.warnings).toEqual([])
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0]).toMatchObject({ originalName: proxy.name, config: node.config })
    expect(result.nodes[0].fingerprint).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('模板到配置', () => {
  it('内置模板加载后可配合导入节点生成 YAML', async () => {
    const { nodes } = await parseProxyText(uri)
    const importedNodes = nodes.map(({ originalName, config, fingerprint }) => ({
      nodeId: fingerprint,
      physicalNodeId: fingerprint,
      name: originalName,
      config,
    }))

    expect(builtinTemplates.length).toBeGreaterThan(0)
    for (const template of builtinTemplates) {
      expect(template.sourceSlots).toEqual([])
      const output = parse(renderMihomoConfig({ template, globalNodes: importedNodes, slotNodes: [] }))
      const original = parse(template.yaml)

      expect(output.proxies).toEqual([{ ...nodes[0].config, name: proxy.name }])
      expect(output['proxy-groups']).toEqual(original['proxy-groups'])
      expect(output.rules).toEqual(original.rules)
      expect(output.dns).toEqual(original.dns)
    }
  })

  it('可视化修改代理组后保留规则引用，并展开节点槽位', () => {
    const slot: TemplateSourceSlot = { key: '__WANGWANG_SOURCE_SLOT_NodesA__', name: '节点槽位', type: 'nodes' }
    const yaml = stringify({
      'mixed-port': 7890,
      dns: { enable: true, nameserver: ['223.5.5.5'] },
      'proxy-groups': [{ name: '选择', type: 'select', proxies: [slot.key, 'DIRECT'] }],
      rules: ['MATCH,选择'],
    })
    const { draft } = parseVisualTemplate(yaml, [slot])
    draft.groups[0].name = '出口'
    expect(validateVisualDraft(draft).filter(({ level }) => level === 'error')).toEqual([])

    const edited = applyVisualTemplate(yaml, draft)
    const output = parse(
      renderMihomoConfig({
        template: { yaml: edited, sourceSlots: [slot] },
        globalNodes: [],
        slotNodes: [{ ...node, slotKey: slot.key }],
      }),
    )

    expect(output.proxies).toEqual([{ ...node.config, name: proxy.name }])
    expect(output['proxy-groups'][0]).toMatchObject({ name: '出口', proxies: [proxy.name, 'DIRECT'] })
    expect(output.rules).toEqual(['MATCH,出口'])
    expect(output['mixed-port']).toBe(7890)
    expect(output.dns).toEqual(parse(yaml).dns)
  })

  it('订阅源槽位生成 provider 引用，无需展开本地节点', () => {
    const slot: TemplateSourceSlot = {
      key: '__WANGWANG_SOURCE_SLOT_AirptA__',
      name: '订阅源槽位',
      type: 'subscription',
    }
    const providerName = slotProviderName(slot.key)
    const provider = {
      type: 'http' as const,
      url: 'https://subscription.example.com/config.yaml',
      path: `./proxy_providers/${providerName}.yaml`,
      interval: 3600,
      header: { 'User-Agent': ['mihomo'] },
      'health-check': { enable: true, url: 'https://www.gstatic.com/generate_204', interval: 300 },
    }
    const output = parse(
      renderMihomoConfig({
        template: {
          yaml: stringify({
            'proxy-groups': [{ name: '出口', type: 'select', use: [slot.key] }],
            rules: ['MATCH,出口'],
          }),
          sourceSlots: [slot],
        },
        globalNodes: [],
        slotNodes: [],
        proxyProviders: { [providerName]: provider },
      }),
    )

    expect(output.proxies).toEqual([])
    expect(output['proxy-providers']).toEqual({ [providerName]: provider })
    expect(output['proxy-groups'][0].use).toEqual([providerName])
    expect(output.rules).toEqual(['MATCH,出口'])
  })
})
