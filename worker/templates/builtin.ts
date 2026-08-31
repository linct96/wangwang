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
geodata-mode: true

geo-auto-update: true

geo-update-interval: 24

geox-url:
  geoip: "https://gh-proxy.com/https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip-lite.dat"
  geosite: "https://gh-proxy.com/https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite-lite.dat"
  mmdb: "https://gh-proxy.com/https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/country-lite.mmdb"
  asn: "https://gh-proxy.com/https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/GeoLite2-ASN.mmdb"
dns:
  enable: true
  respect-rules: true
  enhanced-mode: fake-ip
  listen: 0.0.0.0:1053
  prefer-h3: false
  ipv6: false
  fake-ip-range: 198.18.0.1/16
  fake-ip-filter:
    - '*.lan'
    - '*.local'
    - '*.localdomain'
    - localhost
    - '*.ntp.org'
    - +.stun.*.*
    - +.stun.*.*.*
    - +.stun.*.*.*.*
    - +.stun.*.*.*.*.*
    - '*.n.n.srv.nintendo.net'
    - +.stun.playstation.net
    - '*.xboxlive.com'
  default-nameserver:
    - 223.5.5.5
    - 119.29.29.29
    - 180.184.101.101
    - 114.114.114.114
  nameserver:
    - https://doh.pub/dns-query
    - tls://dot.pub
    - https://dns.alidns.com/dns-query
    - tls://dns.alidns.com
    - https://nas.ip33.com/dns-query
  proxy-server-nameserver:
    - 223.5.5.5
    - 119.29.29.29
    - 180.184.101.101
  nameserver-policy:
    'geosite:cn,private':
      - https://223.5.5.5/dns-query
      - https://doh.pub/dns-query
    'geosite:geolocation-!cn':
      - 'tcp://1.1.1.1'
      - 'tcp://8.8.8.8'
      - 'https://dns.google/dns-query'
proxy-groups:
  - name: 🚀 节点选择
    type: select
    proxies:
      - ⚡ 自动选择
      - ♻️ 故障转移
      - __WANGWANG_CUSTOM_SOURCE_NODES__
      - DIRECT
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
rule-providers:
  category-ads-all:
    type: http
    behavior: domain
    format: mrs
    url: "https://gh-proxy.com/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/category-ads-all.mrs"
    path: ./ruleset/category-ads-all.mrs
    interval: 86400
  private:
    type: http
    behavior: domain
    format: mrs
    url: "https://gh-proxy.com/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/private.mrs"
    path: ./ruleset/private.mrs
    interval: 86400
  private-ip:
    type: http
    behavior: ipcidr
    format: mrs
    url: "https://gh-proxy.com/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/private.mrs"
    path: ./ruleset/private-ip.mrs
    interval: 86400
  cn:
    type: http
    behavior: domain
    format: mrs
    url: "https://gh-proxy.com/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/cn.mrs"
    path: ./ruleset/cn.mrs
    interval: 86400
  cn-ip:
    type: http
    behavior: ipcidr
    format: mrs
    url: "https://gh-proxy.com/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/cn.mrs"
    path: ./ruleset/cn-ip.mrs
    interval: 86400
rules:
  - RULE-SET,category-ads-all,REJECT
  - RULE-SET,private,DIRECT
  - RULE-SET,private-ip,DIRECT,no-resolve
  - RULE-SET,cn,DIRECT
  - RULE-SET,cn-ip,DIRECT,no-resolve
  - MATCH,🚀 节点选择
`

const standardYaml = `mixed-port: 7890
allow-lan: false
mode: rule
log-level: info
ipv6: false
unified-delay: true
geodata-mode: true

geo-auto-update: true

geo-update-interval: 24

geox-url:
  geoip: "https://gh-proxy.com/https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.dat"
  geosite: "https://gh-proxy.com/https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat"
  mmdb: "https://gh-proxy.com/https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/country.mmdb"
  asn: "https://gh-proxy.com/https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/GeoLite2-ASN.mmdb"
dns:
  enable: true
  respect-rules: true
  enhanced-mode: fake-ip
  listen: 0.0.0.0:1053
  prefer-h3: false
  ipv6: false
  fake-ip-range: 198.18.0.1/16
  fake-ip-filter:
    - '*.lan'
    - '*.local'
    - '*.localdomain'
    - localhost
    - '*.ntp.org'
    - +.stun.*.*
    - +.stun.*.*.*
    - +.stun.*.*.*.*
    - +.stun.*.*.*.*.*
    - '*.n.n.srv.nintendo.net'
    - +.stun.playstation.net
    - '*.xboxlive.com'
  default-nameserver:
    - 223.5.5.5
    - 119.29.29.29
    - 180.184.101.101
    - 114.114.114.114
  nameserver:
    - https://doh.pub/dns-query
    - tls://dot.pub
    - https://dns.alidns.com/dns-query
    - tls://dns.alidns.com
    - https://nas.ip33.com/dns-query
  proxy-server-nameserver:
    - 223.5.5.5
    - 119.29.29.29
    - 180.184.101.101
  nameserver-policy:
    'geosite:cn,private':
      - https://223.5.5.5/dns-query
      - https://doh.pub/dns-query
    'geosite:geolocation-!cn':
      - 'tcp://1.1.1.1'
      - 'tcp://8.8.8.8'
      - 'https://dns.google/dns-query'
proxy-groups:
  - name: 🚀 节点选择
    type: select
    proxies:
      - ⚡ 自动选择
      - ♻️ 故障转移
      - __WANGWANG_CUSTOM_SOURCE_NODES__
      - DIRECT
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
rule-providers:
  category-ads-all:
    type: http
    behavior: domain
    format: mrs
    url: "https://gh-proxy.com/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/category-ads-all.mrs"
    path: ./ruleset/category-ads-all.mrs
    interval: 86400
  private:
    type: http
    behavior: domain
    format: mrs
    url: "https://gh-proxy.com/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/private.mrs"
    path: ./ruleset/private.mrs
    interval: 86400
  private-ip:
    type: http
    behavior: ipcidr
    format: mrs
    url: "https://gh-proxy.com/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/private.mrs"
    path: ./ruleset/private-ip.mrs
    interval: 86400
  cn:
    type: http
    behavior: domain
    format: mrs
    url: "https://gh-proxy.com/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/cn.mrs"
    path: ./ruleset/cn.mrs
    interval: 86400
  cn-ip:
    type: http
    behavior: ipcidr
    format: mrs
    url: "https://gh-proxy.com/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/cn.mrs"
    path: ./ruleset/cn-ip.mrs
    interval: 86400
  geolocation-not-cn:
    type: http
    behavior: domain
    format: mrs
    url: "https://gh-proxy.com/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/geolocation-!cn.mrs"
    path: ./ruleset/geolocation-not-cn.mrs
    interval: 86400
rules:
  - RULE-SET,category-ads-all,REJECT
  - RULE-SET,private,DIRECT
  - RULE-SET,private-ip,DIRECT,no-resolve
  - RULE-SET,cn,DIRECT
  - RULE-SET,cn-ip,DIRECT,no-resolve
  - RULE-SET,geolocation-not-cn,🚀 节点选择
  - MATCH,🚀 节点选择
`

const fullYaml = `mixed-port: 7890
allow-lan: false
mode: rule
log-level: info
ipv6: false
unified-delay: true
geodata-mode: true

geo-auto-update: true

geo-update-interval: 24

geox-url:
  geoip: "https://gh-proxy.com/https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.dat"
  geosite: "https://gh-proxy.com/https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat"
  mmdb: "https://gh-proxy.com/https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/country.mmdb"
  asn: "https://gh-proxy.com/https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/GeoLite2-ASN.mmdb"
dns:
  enable: true
  respect-rules: true
  enhanced-mode: fake-ip
  listen: 0.0.0.0:1053
  prefer-h3: false
  ipv6: false
  fake-ip-range: 198.18.0.1/16
  fake-ip-filter:
    - '*.lan'
    - '*.local'
    - '*.localdomain'
    - localhost
    - '*.ntp.org'
    - +.stun.*.*
    - +.stun.*.*.*
    - +.stun.*.*.*.*
    - +.stun.*.*.*.*.*
    - '*.n.n.srv.nintendo.net'
    - +.stun.playstation.net
    - '*.xboxlive.com'
  default-nameserver:
    - 223.5.5.5
    - 119.29.29.29
    - 180.184.101.101
    - 114.114.114.114
  nameserver:
    - https://doh.pub/dns-query
    - tls://dot.pub
    - https://dns.alidns.com/dns-query
    - tls://dns.alidns.com
    - https://nas.ip33.com/dns-query
  proxy-server-nameserver:
    - 223.5.5.5
    - 119.29.29.29
    - 180.184.101.101
  nameserver-policy:
    'geosite:cn,private':
      - https://223.5.5.5/dns-query
      - https://doh.pub/dns-query
    'geosite:geolocation-!cn':
      - 'tcp://1.1.1.1'
      - 'tcp://8.8.8.8'
      - 'https://dns.google/dns-query'
proxy-groups:
  - name: 🚀 节点选择
    type: select
    proxies:
      - ⚡ 自动选择
      - ♻️ 故障转移
      - __WANGWANG_CUSTOM_SOURCE_NODES__
      - DIRECT
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
    proxies: [🚀 节点选择, ⚡ 自动选择, DIRECT]
  - name: 🔍 Google
    type: select
    proxies: [🚀 节点选择, ⚡ 自动选择, DIRECT]
  - name: ✈️ Telegram
    type: select
    proxies: [🚀 节点选择, ⚡ 自动选择, DIRECT]
  - name: 🎬 流媒体
    type: select
    proxies: [🚀 节点选择, ⚡ 自动选择, DIRECT]
  - name: Ⓜ️ Microsoft
    type: select
    proxies: [🚀 节点选择, ⚡ 自动选择, DIRECT]
  - name: 🍎 Apple
    type: select
    proxies: [🚀 节点选择, ⚡ 自动选择, DIRECT]
rule-providers:
  category-ads-all:
    type: http
    behavior: domain
    format: mrs
    url: "https://gh-proxy.com/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/category-ads-all.mrs"
    path: ./ruleset/category-ads-all.mrs
    interval: 86400
  private:
    type: http
    behavior: domain
    format: mrs
    url: "https://gh-proxy.com/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/private.mrs"
    path: ./ruleset/private.mrs
    interval: 86400
  private-ip:
    type: http
    behavior: ipcidr
    format: mrs
    url: "https://gh-proxy.com/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/private.mrs"
    path: ./ruleset/private-ip.mrs
    interval: 86400
  ai-not-cn:
    type: http
    behavior: domain
    format: mrs
    url: "https://gh-proxy.com/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/category-ai-!cn.mrs"
    path: ./ruleset/ai-not-cn.mrs
    interval: 86400
  google:
    type: http
    behavior: domain
    format: mrs
    url: "https://gh-proxy.com/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/google.mrs"
    path: ./ruleset/google.mrs
    interval: 86400
  telegram:
    type: http
    behavior: domain
    format: mrs
    url: "https://gh-proxy.com/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/telegram.mrs"
    path: ./ruleset/telegram.mrs
    interval: 86400
  telegram-ip:
    type: http
    behavior: ipcidr
    format: mrs
    url: "https://gh-proxy.com/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/telegram.mrs"
    path: ./ruleset/telegram-ip.mrs
    interval: 86400
  youtube:
    type: http
    behavior: domain
    format: mrs
    url: "https://gh-proxy.com/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/youtube.mrs"
    path: ./ruleset/youtube.mrs
    interval: 86400
  netflix:
    type: http
    behavior: domain
    format: mrs
    url: "https://gh-proxy.com/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/netflix.mrs"
    path: ./ruleset/netflix.mrs
    interval: 86400
  spotify:
    type: http
    behavior: domain
    format: mrs
    url: "https://gh-proxy.com/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/spotify.mrs"
    path: ./ruleset/spotify.mrs
    interval: 86400
  tiktok:
    type: http
    behavior: domain
    format: mrs
    url: "https://gh-proxy.com/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/tiktok.mrs"
    path: ./ruleset/tiktok.mrs
    interval: 86400
  microsoft:
    type: http
    behavior: domain
    format: mrs
    url: "https://gh-proxy.com/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/microsoft.mrs"
    path: ./ruleset/microsoft.mrs
    interval: 86400
rules:
  - RULE-SET,category-ads-all,REJECT
  - RULE-SET,private,DIRECT
  - RULE-SET,private-ip,DIRECT,no-resolve
  - RULE-SET,ai-not-cn,🤖 AI 服务
  - RULE-SET,google,🔍 Google
  - RULE-SET,telegram,✈️ Telegram
  - RULE-SET,telegram-ip,✈️ Telegram,no-resolve
  - RULE-SET,youtube,🎬 流媒体
  - RULE-SET,netflix,🎬 流媒体
  - RULE-SET,spotify,🎬 流媒体
  - RULE-SET,tiktok,🎬 流媒体
  - RULE-SET,microsoft,Ⓜ️ Microsoft
  - GEOSITE,apple,🍎 Apple
  - GEOSITE,cn,DIRECT
  - GEOIP,CN,DIRECT,no-resolve
  - GEOSITE,geolocation-!cn,🚀 节点选择
  - MATCH,🚀 节点选择
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
    description: '常用分流规则 / 国内直连 / 国外代理',
    yaml: standardYaml,
  },
  {
    id: 'builtin:full',
    name: '完全规则模板',
    description: '完整规则 / AI / Google / Telegram 等',
    yaml: fullYaml,
  },
]

export function builtinTemplate(id: string) {
  return builtinTemplates.find((template) => template.id === id)
}
