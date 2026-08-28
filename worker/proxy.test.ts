import { describe, expect, it } from 'vitest'
import { editableProxyYaml, parseProxyText, proxyConfigError, restoreProxySecrets } from './proxy'

describe('parseProxyText', () => {
  it('解析批量 URI 和 Mihomo YAML，并去重无效行', async () => {
    const vless = 'vless://00000000-0000-0000-0000-000000000001@example.com:443#香港'
    const links = await parseProxyText([vless, vless, 'invalid', 'trojan://secret@example.net:443#日本'].join('\n'))

    expect(links.nodes.map((node) => node.config.name)).toEqual(['香港', '日本'])
    expect(links.warnings).toHaveLength(1)

    const yaml = await parseProxyText(`
- name: 新加坡
  type: ss
  server: sg.example.com
  port: 8388
  cipher: aes-128-gcm
  password: secret
`)

    expect(yaml.nodes).toHaveLength(1)
    expect(yaml.nodes[0]?.config).toMatchObject({ name: '新加坡', type: 'ss', server: 'sg.example.com', port: 8388 })

    const editable = editableProxyYaml(yaml.nodes[0]!.config)
    expect(editable).not.toContain('password: secret')
    const edited = await parseProxyText(editable.replace('sg.example.com', 'new.example.com'))
    const restored = restoreProxySecrets(edited.nodes[0]!.config, yaml.nodes[0]!.config)
    expect(restored).toMatchObject({
      server: 'new.example.com',
      password: 'secret',
    })
    expect(proxyConfigError(restored)).toBeNull()
  })

  it('支持解析 SS SIP002 插件配置', async () => {
    const ssUri =
      'ss://YWVzLTEyOC1nY206c2VjcmV0@example.com:8388?plugin=obfs-local%3Bobfs%3Dhttp%3Bobfs-host%3Dexample.com#SS节点'
    const result = await parseProxyText(ssUri)
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0]?.config).toMatchObject({
      type: 'ss',
      server: 'example.com',
      port: 8388,
      cipher: 'aes-128-gcm',
      password: 'secret',
      plugin: 'obfs-local',
      'plugin-opts': {
        obfs: 'http',
        'obfs-host': 'example.com',
      },
    })
  })

  it('支持解析 Hysteria2 额外参数 (pin-sha256, ech)', async () => {
    const hy2Uri = 'hysteria2://secret@hy2.example.com:443?pinSHA256=abcdef&ech=true#Hy2'
    const result = await parseProxyText(hy2Uri)
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0]?.config).toMatchObject({
      type: 'hysteria2',
      server: 'hy2.example.com',
      port: 443,
      password: 'secret',
      'pin-sha256': 'abcdef',
      ech: 'true',
    })
  })

  it('支持解析 VLESS 传输层与 Reality 参数', async () => {
    const vlessReality =
      'vless://00000000-0000-0000-0000-000000000001@example.com:443?security=reality&sni=sni.example.com&fp=chrome&pbk=pubkey123&sid=sid456&type=ws&path=%2Fws#VLESS-Reality'
    const result = await parseProxyText(vlessReality)
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0]?.config).toMatchObject({
      type: 'vless',
      server: 'example.com',
      port: 443,
      uuid: '00000000-0000-0000-0000-000000000001',
      network: 'ws',
      'ws-opts': { path: '/ws' },
      tls: true,
      servername: 'sni.example.com',
      'client-fingerprint': 'chrome',
      'reality-opts': {
        'public-key': 'pubkey123',
        'short-id': 'sid456',
      },
    })
  })

  it('为 VLESS H2 使用 h2-opts', async () => {
    const result = await parseProxyText(
      'vless://00000000-0000-0000-0000-000000000001@example.com:443?type=h2&path=%2Fh2&host=cdn.example.com#VLESS-H2',
    )
    expect(result.nodes[0]?.config).toMatchObject({
      network: 'h2',
      'h2-opts': { path: '/h2', host: ['cdn.example.com'] },
    })
    expect(result.nodes[0]?.config).not.toHaveProperty('http-opts')
  })

  it('支持解析 Trojan 传输层参数', async () => {
    const result = await parseProxyText(
      'trojan://password@example.com:443?type=ws&path=%2Ftrojan&host=cdn.example.com#Trojan',
    )
    expect(result.nodes[0]?.config).toMatchObject({
      type: 'trojan',
      network: 'ws',
      'ws-opts': { path: '/trojan', headers: { Host: 'cdn.example.com' } },
    })
  })

  it('支持过滤无效 YAML 节点并记录警告信息', async () => {
    const yaml = `
proxies:
  - invalid-string-item
  - name: 缺字段节点
    type: ss
  - name: 有效节点
    type: ss
    server: ss.example.com
    port: 8388
    cipher: aes-128-gcm
    password: secret
`
    const result = await parseProxyText(yaml)
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0]?.config.name).toBe('有效节点')
    expect(result.warnings.length).toBeGreaterThanOrEqual(2)
  })
})
