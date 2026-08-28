import type { TemplateId } from '../db'

export type BuiltinTemplate = {
  id: Extract<TemplateId, `builtin:${string}`>
  name: string
  description: string
  yaml: string
  revision: number
}

const minimalYaml = `mixed-port: 7890
allow-lan: false
mode: rule
log-level: info
ipv6: false
unified-delay: true
dns:
  enable: true
  ipv6: false
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  default-nameserver:
    - 223.5.5.5
    - 1.1.1.1
  nameserver:
    - https://dns.alidns.com/dns-query
    - https://1.1.1.1/dns-query
proxy-groups:
  - name: 节点选择
    type: select
    proxies:
      - 自动选择
      - 故障转移
      - __WANGWANG_ALL_PROXIES__
      - DIRECT
  - name: 自动选择
    type: url-test
    url: https://www.gstatic.com/generate_204
    interval: 300
    tolerance: 50
    proxies:
      - __WANGWANG_ALL_PROXIES__
  - name: 故障转移
    type: fallback
    url: https://www.gstatic.com/generate_204
    interval: 300
    proxies:
      - __WANGWANG_ALL_PROXIES__
rules:
  - GEOSITE,category-ads-all,REJECT
  - GEOSITE,private,DIRECT
  - GEOIP,private,DIRECT,no-resolve
  - GEOSITE,cn,DIRECT
  - GEOIP,CN,DIRECT,no-resolve
  - MATCH,节点选择
`

const fullYaml = `mixed-port: 7890
allow-lan: false
mode: rule
log-level: info
ipv6: false
unified-delay: true
dns:
  enable: true
  ipv6: false
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  default-nameserver:
    - 223.5.5.5
    - 1.1.1.1
  nameserver:
    - https://dns.alidns.com/dns-query
    - https://1.1.1.1/dns-query
proxy-groups:
  - name: 节点选择
    type: select
    proxies:
      - 自动选择
      - 故障转移
      - __WANGWANG_ALL_PROXIES__
      - DIRECT
  - name: 自动选择
    type: url-test
    url: https://www.gstatic.com/generate_204
    interval: 300
    tolerance: 50
    proxies:
      - __WANGWANG_ALL_PROXIES__
  - name: 故障转移
    type: fallback
    url: https://www.gstatic.com/generate_204
    interval: 300
    proxies:
      - __WANGWANG_ALL_PROXIES__
  - name: AI 服务
    type: select
    proxies: [节点选择, 自动选择, DIRECT]
  - name: Google
    type: select
    proxies: [节点选择, 自动选择, DIRECT]
  - name: Telegram
    type: select
    proxies: [节点选择, 自动选择, DIRECT]
  - name: 流媒体
    type: select
    proxies: [节点选择, 自动选择, DIRECT]
  - name: Microsoft
    type: select
    proxies: [节点选择, 自动选择, DIRECT]
  - name: Apple
    type: select
    proxies: [节点选择, 自动选择, DIRECT]
rules:
  - GEOSITE,category-ads-all,REJECT
  - GEOSITE,private,DIRECT
  - GEOIP,private,DIRECT,no-resolve
  - GEOSITE,category-ai-!cn,AI 服务
  - GEOSITE,google,Google
  - GEOSITE,telegram,Telegram
  - GEOIP,telegram,Telegram,no-resolve
  - GEOSITE,youtube,流媒体
  - GEOSITE,netflix,流媒体
  - GEOSITE,spotify,流媒体
  - GEOSITE,tiktok,流媒体
  - GEOSITE,microsoft,Microsoft
  - GEOSITE,apple,Apple
  - GEOSITE,cn,DIRECT
  - GEOIP,CN,DIRECT,no-resolve
  - GEOSITE,geolocation-!cn,节点选择
  - MATCH,节点选择
`

export const builtinTemplates: BuiltinTemplate[] = [
  {
    id: 'builtin:minimal',
    name: '精简模板',
    description: '基础 DNS / 国内直连 / 自动选择',
    yaml: minimalYaml,
    revision: 1,
  },
  {
    id: 'builtin:full',
    name: '全规则模板',
    description: '完整规则 / AI / Google / Telegram 等',
    yaml: fullYaml,
    revision: 1,
  },
]

export function builtinTemplate(id: string) {
  return builtinTemplates.find((template) => template.id === id)
}
