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
})
