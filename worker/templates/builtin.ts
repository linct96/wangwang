import type { TemplateId } from '../db'

export type BuiltinTemplate = {
  id: Extract<TemplateId, `builtin:${string}`>
  name: string
  description: string
  yaml: string
}

const minimalYaml = `mixed-port: 7890
allow-lan: false
mode: rule
log-level: info
ipv6: false
unified-delay: true
dns:
  enable: true
  listen: 0.0.0.0:1053
  ipv6: false
  enhanced-mode: fake-ip
  respect-rules: true
  fake-ip-range: 198.18.0.1/16
  fake-ip-filter:
    - "*.lan"
    - "*.local"
    - "*.localdomain"
    - localhost
    - localhost.ptlogin2.qq.com
    - localhost.sec.qq.com
    - localhost.weixin.qq.com
    - localhost.work.weixin.qq.com
    - "localhost.*.weixin.qq.com"
    - "*.ntp.org"
    - +.stun.*.*
    - +.stun.*.*.*
    - +.stun.*.*.*.*
    - +.stun.*.*.*.*.*
    - "*.n.n.srv.nintendo.net"
    - +.stun.playstation.net
    - "*.xboxlive.com"
  default-nameserver:
    - 223.5.5.5
    - 119.29.29.29
  nameserver:
    - "https://dns.google/dns-query"
    - "https://cloudflare-dns.com/dns-query"
  proxy-server-nameserver:
    - 223.5.5.5
    - 119.29.29.29
    - https://dns.alidns.com/dns-query
    - https://doh.pub/dns-query
  direct-nameserver:
    - https://dns.alidns.com/dns-query
    - https://doh.pub/dns-query
  direct-nameserver-follow-policy: true
  nameserver-policy:
    "rule-set:private-domain":
      - https://dns.alidns.com/dns-query
      - https://doh.pub/dns-query
    "rule-set:cn-domain":
      - https://dns.alidns.com/dns-query
      - https://doh.pub/dns-query
proxy-groups:
  - name: 🚀 节点选择
    type: select
    proxies:
      - ⚡ 自动选择
      - DIRECT
      - __WANGWANG_CUSTOM_SOURCE_NODES__
  - name: ⚡ 自动选择
    type: url-test
    url: https://www.gstatic.com/generate_204
    interval: 300
    tolerance: 50
    proxies:
      - __WANGWANG_CUSTOM_SOURCE_NODES__
rule-providers:
  private-domain:
    type: http
    behavior: domain
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/private.mrs"
    path: ./ruleset/private.mrs
    interval: 86400
  private-ip:
    type: http
    behavior: ipcidr
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/private.mrs"
    path: ./ruleset/private-ip.mrs
    interval: 86400
  cn-domain:
    type: http
    behavior: domain
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/cn.mrs"
    path: ./ruleset/cn.mrs
    interval: 86400
  cn-ip:
    type: http
    behavior: ipcidr
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/cn.mrs"
    path: ./ruleset/cn-ip.mrs
    interval: 86400
rules:
  - RULE-SET,private-domain,DIRECT
  - RULE-SET,private-ip,DIRECT,no-resolve
  - RULE-SET,cn-domain,DIRECT
  - RULE-SET,cn-ip,DIRECT,no-resolve
  - MATCH,🚀 节点选择
`

const standardYaml = `mixed-port: 7890
allow-lan: false
mode: rule
log-level: info
ipv6: false
unified-delay: true
dns:
  enable: true
  listen: 0.0.0.0:1053
  ipv6: false
  enhanced-mode: fake-ip
  respect-rules: true
  fake-ip-range: 198.18.0.1/16
  fake-ip-filter:
    - "*.lan"
    - "*.local"
    - "*.localdomain"
    - localhost
    - localhost.ptlogin2.qq.com
    - localhost.sec.qq.com
    - localhost.weixin.qq.com
    - localhost.work.weixin.qq.com
    - "localhost.*.weixin.qq.com"
    - "*.ntp.org"
    - +.stun.*.*
    - +.stun.*.*.*
    - +.stun.*.*.*.*
    - +.stun.*.*.*.*.*
    - "*.n.n.srv.nintendo.net"
    - +.stun.playstation.net
    - "*.xboxlive.com"
  default-nameserver:
    - 223.5.5.5
    - 119.29.29.29
  nameserver:
    - "https://dns.google/dns-query"
    - "https://cloudflare-dns.com/dns-query"
  proxy-server-nameserver:
    - 223.5.5.5
    - 119.29.29.29
    - https://dns.alidns.com/dns-query
    - https://doh.pub/dns-query
  direct-nameserver:
    - https://dns.alidns.com/dns-query
    - https://doh.pub/dns-query
  direct-nameserver-follow-policy: true
  nameserver-policy:
    "rule-set:private-domain":
      - https://dns.alidns.com/dns-query
      - https://doh.pub/dns-query
    "rule-set:cn-domain":
      - https://dns.alidns.com/dns-query
      - https://doh.pub/dns-query
proxy-groups:
  - name: 🚀 节点选择
    type: select
    proxies:
      - ⚡ 自动选择
      - ♻️ 故障转移
      - DIRECT
      - __WANGWANG_CUSTOM_SOURCE_NODES__
  - name: ⚡ 自动选择
    type: url-test
    url: https://www.gstatic.com/generate_204
    interval: 300
    tolerance: 50
    proxies:
      - __WANGWANG_CUSTOM_SOURCE_NODES__
  - name: ♻️ 故障转移
    type: fallback
    url: https://www.gstatic.com/generate_204
    interval: 300
    proxies:
      - __WANGWANG_CUSTOM_SOURCE_NODES__
  - name: 🤖 AI 服务
    type: select
    proxies:
      - 🚀 节点选择
      - ⚡ 自动选择
      - DIRECT
      - __WANGWANG_CUSTOM_SOURCE_NODES__
  - name: 🎬 流媒体
    type: select
    proxies:
      - 🚀 节点选择
      - ⚡ 自动选择
      - DIRECT
      - __WANGWANG_CUSTOM_SOURCE_NODES__
  - name: 🐟 漏网之鱼
    type: select
    proxies:
      - 🚀 节点选择
      - ⚡ 自动选择
      - ♻️ 故障转移
      - DIRECT
  - name: 🛑 广告拦截
    type: select
    default-selected: REJECT
    proxies:
      - REJECT
      - DIRECT
rule-providers:
  private-domain:
    type: http
    behavior: domain
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/private.mrs"
    path: ./ruleset/private.mrs
    interval: 86400
  private-ip:
    type: http
    behavior: ipcidr
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/private.mrs"
    path: ./ruleset/private-ip.mrs
    interval: 86400
  category-ads-all-domain:
    type: http
    behavior: domain
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/category-ads-all.mrs"
    path: ./ruleset/category-ads-all-domain.mrs
    interval: 86400
  category-ai-!cn:
    type: http
    behavior: domain
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/category-ai-!cn.mrs"
    path: ./ruleset/category-ai-!cn.mrs
    interval: 86400
  youtube-domain:
    type: http
    behavior: domain
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/youtube.mrs"
    path: ./ruleset/youtube-domain.mrs
    interval: 86400
  netflix-domain:
    type: http
    behavior: domain
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/netflix.mrs"
    path: ./ruleset/netflix-domain.mrs
    interval: 86400
  spotify-domain:
    type: http
    behavior: domain
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/spotify.mrs"
    path: ./ruleset/spotify-domain.mrs
    interval: 86400
  tiktok-domain:
    type: http
    behavior: domain
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/tiktok.mrs"
    path: ./ruleset/tiktok-domain.mrs
    interval: 86400
  cn-domain:
    type: http
    behavior: domain
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/cn.mrs"
    path: ./ruleset/cn.mrs
    interval: 86400
  cn-ip:
    type: http
    behavior: ipcidr
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/cn.mrs"
    path: ./ruleset/cn-ip.mrs
    interval: 86400
rules:
  - RULE-SET,private-domain,DIRECT
  - RULE-SET,private-ip,DIRECT,no-resolve
  - RULE-SET,category-ads-all-domain,🛑 广告拦截
  - RULE-SET,category-ai-!cn,🤖 AI 服务
  - RULE-SET,youtube-domain,🎬 流媒体
  - RULE-SET,netflix-domain,🎬 流媒体
  - RULE-SET,spotify-domain,🎬 流媒体
  - RULE-SET,tiktok-domain,🎬 流媒体
  - RULE-SET,cn-domain,DIRECT
  - RULE-SET,cn-ip,DIRECT,no-resolve
  - MATCH,🐟 漏网之鱼
`

const fullYaml = `mixed-port: 7890
allow-lan: false
mode: rule
log-level: info
ipv6: false
unified-delay: true
dns:
  enable: true
  listen: 0.0.0.0:1053
  ipv6: false
  enhanced-mode: fake-ip
  respect-rules: true
  fake-ip-range: 198.18.0.1/16
  fake-ip-filter:
    - "*.lan"
    - "*.local"
    - "*.localdomain"
    - localhost
    - localhost.ptlogin2.qq.com
    - localhost.sec.qq.com
    - localhost.weixin.qq.com
    - localhost.work.weixin.qq.com
    - "localhost.*.weixin.qq.com"
    - "*.ntp.org"
    - +.stun.*.*
    - +.stun.*.*.*
    - +.stun.*.*.*.*
    - +.stun.*.*.*.*.*
    - "*.n.n.srv.nintendo.net"
    - +.stun.playstation.net
    - "*.xboxlive.com"
  default-nameserver:
    - 223.5.5.5
    - 119.29.29.29
  nameserver:
    - "https://dns.google/dns-query"
    - "https://cloudflare-dns.com/dns-query"
  proxy-server-nameserver:
    - 223.5.5.5
    - 119.29.29.29
    - https://dns.alidns.com/dns-query
    - https://doh.pub/dns-query
  direct-nameserver:
    - https://dns.alidns.com/dns-query
    - https://doh.pub/dns-query
  direct-nameserver-follow-policy: true
  nameserver-policy:
    "rule-set:private-domain":
      - https://dns.alidns.com/dns-query
      - https://doh.pub/dns-query
    "rule-set:cn-domain":
      - https://dns.alidns.com/dns-query
      - https://doh.pub/dns-query
proxy-groups:
  - name: 🚀 节点选择
    type: select
    proxies:
      - ⚡ 自动选择
      - ♻️ 故障转移
      - ⚖️ 负载均衡
      - DIRECT
      - __WANGWANG_CUSTOM_SOURCE_NODES__
  - name: ⚡ 自动选择
    type: url-test
    url: https://www.gstatic.com/generate_204
    interval: 300
    tolerance: 50
    proxies:
      - __WANGWANG_CUSTOM_SOURCE_NODES__
  - name: ♻️ 故障转移
    type: fallback
    url: https://www.gstatic.com/generate_204
    interval: 300
    proxies:
      - __WANGWANG_CUSTOM_SOURCE_NODES__
  - name: ⚖️ 负载均衡
    type: load-balance
    url: https://www.gstatic.com/generate_204
    interval: 300
    strategy: consistent-hashing
    proxies:
      - __WANGWANG_CUSTOM_SOURCE_NODES__
  - name: 🤖 AI 服务
    type: select
    proxies:
      - 🚀 节点选择
      - ⚡ 自动选择
      - DIRECT
      - __WANGWANG_CUSTOM_SOURCE_NODES__
  - name: 🔍 Google
    type: select
    proxies:
      - 🚀 节点选择
      - ⚡ 自动选择
      - DIRECT
      - __WANGWANG_CUSTOM_SOURCE_NODES__
  - name: ✈️ Telegram
    type: select
    proxies:
      - 🚀 节点选择
      - ⚡ 自动选择
      - DIRECT
      - __WANGWANG_CUSTOM_SOURCE_NODES__
  - name: 🟦 Microsoft
    type: select
    proxies:
      - 🚀 节点选择
      - ⚡ 自动选择
      - DIRECT
      - __WANGWANG_CUSTOM_SOURCE_NODES__
  - name: 🍎 Apple
    type: select
    proxies:
      - DIRECT
      - 🚀 节点选择
      - ⚡ 自动选择
      - __WANGWANG_CUSTOM_SOURCE_NODES__
  - name: 🎬 流媒体
    type: select
    proxies:
      - 🚀 节点选择
      - ⚡ 自动选择
      - DIRECT
      - __WANGWANG_CUSTOM_SOURCE_NODES__
  - name: 🐟 漏网之鱼
    type: select
    proxies:
      - 🚀 节点选择
      - ⚡ 自动选择
      - ♻️ 故障转移
      - ⚖️ 负载均衡
      - DIRECT
  - name: 🛑 广告拦截
    type: select
    default-selected: REJECT
    proxies:
      - REJECT
      - DIRECT
rule-providers:
  category-ads-all-domain:
    type: http
    behavior: domain
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/category-ads-all.mrs"
    path: ./ruleset/category-ads-all-domain.mrs
    interval: 86400
  private-domain:
    type: http
    behavior: domain
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/private.mrs"
    path: ./ruleset/private.mrs
    interval: 86400
  private-ip:
    type: http
    behavior: ipcidr
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/private.mrs"
    path: ./ruleset/private-ip.mrs
    interval: 86400
  category-ai-!cn:
    type: http
    behavior: domain
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/category-ai-!cn.mrs"
    path: ./ruleset/category-ai-!cn.mrs
    interval: 86400
  google-domain:
    type: http
    behavior: domain
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/google.mrs"
    path: ./ruleset/google.mrs
    interval: 86400
  google-ip:
    type: http
    behavior: ipcidr
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/google.mrs"
    path: ./ruleset/google-ip.mrs
    interval: 86400
  telegram-domain:
    type: http
    behavior: domain
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/telegram.mrs"
    path: ./ruleset/telegram.mrs
    interval: 86400
  telegram-ip:
    type: http
    behavior: ipcidr
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/telegram.mrs"
    path: ./ruleset/telegram-ip.mrs
    interval: 86400
  youtube-domain:
    type: http
    behavior: domain
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/youtube.mrs"
    path: ./ruleset/youtube-domain.mrs
    interval: 86400
  netflix-domain:
    type: http
    behavior: domain
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/netflix.mrs"
    path: ./ruleset/netflix-domain.mrs
    interval: 86400
  netflix-ip:
    type: http
    behavior: ipcidr
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/netflix.mrs"
    path: ./ruleset/netflix-ip.mrs
    interval: 86400
  spotify-domain:
    type: http
    behavior: domain
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/spotify.mrs"
    path: ./ruleset/spotify-domain.mrs
    interval: 86400
  tiktok-domain:
    type: http
    behavior: domain
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/tiktok.mrs"
    path: ./ruleset/tiktok-domain.mrs
    interval: 86400
  microsoft-domain:
    type: http
    behavior: domain
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/microsoft.mrs"
    path: ./ruleset/microsoft.mrs
    interval: 86400
  apple-cn-domain:
    type: http
    behavior: domain
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/apple-cn.mrs"
    path: ./ruleset/apple-cn-domain.mrs
    interval: 86400
  apple-domain:
    type: http
    behavior: domain
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/apple.mrs"
    path: ./ruleset/apple-domain.mrs
    interval: 86400
  cn-domain:
    type: http
    behavior: domain
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/cn.mrs"
    path: ./ruleset/cn.mrs
    interval: 86400
  cn-ip:
    type: http
    behavior: ipcidr
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/cn.mrs"
    path: ./ruleset/cn-ip.mrs
    interval: 86400
rules:
  - RULE-SET,private-domain,DIRECT
  - RULE-SET,private-ip,DIRECT,no-resolve

  - RULE-SET,category-ads-all-domain,🛑 广告拦截

  - RULE-SET,category-ai-!cn,🤖 AI 服务

  # YouTube 必须优先于 Google
  - RULE-SET,youtube-domain,🎬 流媒体

  - RULE-SET,google-domain,🔍 Google
  - RULE-SET,google-ip,🔍 Google,no-resolve

  - RULE-SET,telegram-domain,✈️ Telegram
  - RULE-SET,telegram-ip,✈️ Telegram,no-resolve

  - RULE-SET,microsoft-domain,🟦 Microsoft

  - RULE-SET,apple-cn-domain,DIRECT
  - RULE-SET,apple-domain,🍎 Apple

  - RULE-SET,netflix-domain,🎬 流媒体
  - RULE-SET,netflix-ip,🎬 流媒体,no-resolve
  - RULE-SET,spotify-domain,🎬 流媒体
  - RULE-SET,tiktok-domain,🎬 流媒体

  - RULE-SET,cn-domain,DIRECT
  - RULE-SET,cn-ip,DIRECT,no-resolve

  - MATCH,🐟 漏网之鱼
`

export const builtinTemplates: BuiltinTemplate[] = [
  {
    id: 'builtin:minimal',
    name: '精简规则模板',
    description: '基础 DNS / 国内直连 / 自动选择',
    yaml: minimalYaml,
  },
  {
    id: 'builtin:standard',
    name: '标准规则模板',
    description: '常用分流 / 国内直连 / AI 与流媒体',
    yaml: standardYaml,
  },
  {
    id: 'builtin:full',
    name: '完全规则模板',
    description: '标准超集 / 多服务分流 / IP 规则 / 负载均衡',
    yaml: fullYaml,
  },
]

export function builtinTemplate(id: string) {
  return builtinTemplates.find((template) => template.id === id)
}
