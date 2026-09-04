import type { TemplateId } from '../db'

export type BuiltinTemplate = {
  id: Extract<TemplateId, `builtin:${string}`>
  name: string
  description: string
  yaml: string
}

const minimalYaml = `x-wangwang:
  sources:
    - key: __WANGWANG_SOURCE_SLOT_mini01__
      name: 默认节点源
mixed-port: 7890
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
  prefer-h3: false
  fake-ip-range: 198.18.0.1/16
  fake-ip-filter:
    - +.lan
    - +.local
    - +.localdomain
    - localhost
    - localhost.ptlogin2.qq.com
    - localhost.sec.qq.com
    - localhost.weixin.qq.com
    - localhost.*.weixin.qq.com
    - +.ntp.org
    - +.stun.*.*
    - +.stun.*.*.*
    - +.stun.*.*.*.*
    - +.stun.*.*.*.*.*
    - +.n.n.srv.nintendo.net
    - +.stun.playstation.net
    - +.xboxlive.com
  default-nameserver:
    - 223.5.5.5
    - 119.29.29.29
  nameserver:
    - https://cloudflare-dns.com/dns-query
    - https://dns.google/dns-query
  proxy-server-nameserver:
    - https://dns.alidns.com/dns-query
    - https://doh.pub/dns-query
  direct-nameserver:
    - https://dns.alidns.com/dns-query
    - https://doh.pub/dns-query
  direct-nameserver-follow-policy: true
  nameserver-policy:
    "geosite:private":
      - system
    "geosite:cn":
      - https://dns.alidns.com/dns-query
      - https://doh.pub/dns-query
proxy-groups:
  - name: 🚀 节点选择
    type: select
    proxies:
      - ⚡ 自动选择
      - DIRECT
      - __WANGWANG_SOURCE_SLOT_mini01__
  - name: ⚡ 自动选择
    type: url-test
    url: https://www.gstatic.com/generate_204
    interval: 300
    tolerance: 50
    proxies:
      - __WANGWANG_SOURCE_SLOT_mini01__
rule-providers:
  private-domain:
    type: http
    behavior: domain
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/private.mrs"
    path: ./ruleset/private-domain.mrs
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
    path: ./ruleset/cn-domain.mrs
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

const standardYaml = `x-wangwang:
  sources:
    - key: __WANGWANG_SOURCE_SLOT_std001__
      name: 默认节点源
mixed-port: 7890
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
  prefer-h3: false
  fake-ip-range: 198.18.0.1/16
  fake-ip-filter:
    - +.lan
    - +.local
    - +.localdomain
    - localhost
    - localhost.ptlogin2.qq.com
    - localhost.sec.qq.com
    - localhost.weixin.qq.com
    - localhost.*.weixin.qq.com
    - +.ntp.org
    - +.stun.*.*
    - +.stun.*.*.*
    - +.stun.*.*.*.*
    - +.stun.*.*.*.*.*
    - +.n.n.srv.nintendo.net
    - +.stun.playstation.net
    - +.xboxlive.com
  default-nameserver:
    - 223.5.5.5
    - 119.29.29.29
  nameserver:
    - https://cloudflare-dns.com/dns-query
    - https://dns.google/dns-query
  proxy-server-nameserver:
    - https://dns.alidns.com/dns-query
    - https://doh.pub/dns-query
  direct-nameserver:
    - https://dns.alidns.com/dns-query
    - https://doh.pub/dns-query
  direct-nameserver-follow-policy: true
  nameserver-policy:
    "geosite:private":
      - system
    "geosite:cn":
      - https://dns.alidns.com/dns-query
      - https://doh.pub/dns-query
proxy-groups:
  - name: 🚀 节点选择
    type: select
    proxies:
      - ⚡ 自动选择
      - ♻️ 故障转移
      - DIRECT
      - __WANGWANG_SOURCE_SLOT_std001__
  - name: ⚡ 自动选择
    type: url-test
    url: https://www.gstatic.com/generate_204
    interval: 300
    tolerance: 50
    proxies:
      - __WANGWANG_SOURCE_SLOT_std001__
  - name: ♻️ 故障转移
    type: fallback
    url: https://www.gstatic.com/generate_204
    interval: 300
    proxies:
      - __WANGWANG_SOURCE_SLOT_std001__
  - name: 🤖 AI 服务
    type: select
    proxies:
      - 🚀 节点选择
      - ⚡ 自动选择
      - ♻️ 故障转移
      - DIRECT
      - __WANGWANG_SOURCE_SLOT_std001__
  - name: 🎬 流媒体
    type: select
    proxies:
      - 🚀 节点选择
      - ⚡ 自动选择
      - ♻️ 故障转移
      - DIRECT
      - __WANGWANG_SOURCE_SLOT_std001__
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
    path: ./ruleset/private-domain.mrs
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
  category-ai-!cn-domain:
    type: http
    behavior: domain
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/category-ai-!cn.mrs"
    path: ./ruleset/category-ai-!cn-domain.mrs
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
    path: ./ruleset/cn-domain.mrs
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
  - RULE-SET,category-ai-!cn-domain,🤖 AI 服务
  - RULE-SET,youtube-domain,🎬 流媒体
  - RULE-SET,netflix-domain,🎬 流媒体
  - RULE-SET,spotify-domain,🎬 流媒体
  - RULE-SET,tiktok-domain,🎬 流媒体
  - RULE-SET,cn-domain,DIRECT
  - RULE-SET,cn-ip,DIRECT,no-resolve
  - MATCH,🐟 漏网之鱼
`

const fullYaml = `x-wangwang:
  sources:
    - key: __WANGWANG_SOURCE_SLOT_full01__
      name: 默认节点源
mixed-port: 7890
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
  prefer-h3: false
  fake-ip-range: 198.18.0.1/16
  fake-ip-filter:
    - +.lan
    - +.local
    - +.localdomain
    - localhost
    - localhost.ptlogin2.qq.com
    - localhost.sec.qq.com
    - localhost.weixin.qq.com
    - localhost.*.weixin.qq.com
    - +.ntp.org
    - +.stun.*.*
    - +.stun.*.*.*
    - +.stun.*.*.*.*
    - +.stun.*.*.*.*.*
    - +.n.n.srv.nintendo.net
    - +.stun.playstation.net
    - +.xboxlive.com
  default-nameserver:
    - 223.5.5.5
    - 119.29.29.29
  nameserver:
    - https://cloudflare-dns.com/dns-query
    - https://dns.google/dns-query
  proxy-server-nameserver:
    - https://dns.alidns.com/dns-query
    - https://doh.pub/dns-query
  direct-nameserver:
    - https://dns.alidns.com/dns-query
    - https://doh.pub/dns-query
  direct-nameserver-follow-policy: true
  nameserver-policy:
    "geosite:private":
      - system
    "geosite:cn":
      - https://dns.alidns.com/dns-query
      - https://doh.pub/dns-query
proxy-groups:
  - name: 🚀 节点选择
    type: select
    proxies:
      - ⚡ 自动选择
      - ♻️ 故障转移
      - DIRECT
      - __WANGWANG_SOURCE_SLOT_full01__
  - name: ⚡ 自动选择
    type: url-test
    url: https://www.gstatic.com/generate_204
    interval: 300
    tolerance: 50
    proxies:
      - __WANGWANG_SOURCE_SLOT_full01__
  - name: ♻️ 故障转移
    type: fallback
    url: https://www.gstatic.com/generate_204
    interval: 300
    proxies:
      - __WANGWANG_SOURCE_SLOT_full01__
  - name: 🤖 AI 服务
    type: select
    proxies:
      - 🚀 节点选择
      - ⚡ 自动选择
      - ♻️ 故障转移
      - DIRECT
      - __WANGWANG_SOURCE_SLOT_full01__
  - name: 🐱 GitHub
    type: select
    proxies:
      - 🚀 节点选择
      - ⚡ 自动选择
      - ♻️ 故障转移
      - DIRECT
      - __WANGWANG_SOURCE_SLOT_full01__
  - name: 🔍 Google
    type: select
    proxies:
      - 🚀 节点选择
      - ⚡ 自动选择
      - ♻️ 故障转移
      - DIRECT
      - __WANGWANG_SOURCE_SLOT_full01__
  - name: ✈️ Telegram
    type: select
    proxies:
      - 🚀 节点选择
      - ⚡ 自动选择
      - ♻️ 故障转移
      - DIRECT
      - __WANGWANG_SOURCE_SLOT_full01__
  - name: Ⓜ️ Microsoft
    type: select
    proxies:
      - 🚀 节点选择
      - ⚡ 自动选择
      - ♻️ 故障转移
      - DIRECT
      - __WANGWANG_SOURCE_SLOT_full01__
  - name: 🍎 Apple
    type: select
    proxies:
      - 🚀 节点选择
      - ⚡ 自动选择
      - ♻️ 故障转移
      - DIRECT
      - __WANGWANG_SOURCE_SLOT_full01__
  - name: 🎮 游戏平台
    type: select
    proxies:
      - 🚀 节点选择
      - ⚡ 自动选择
      - ♻️ 故障转移
      - DIRECT
      - __WANGWANG_SOURCE_SLOT_full01__
  - name: 🎬 流媒体
    type: select
    proxies:
      - 🚀 节点选择
      - ⚡ 自动选择
      - ♻️ 故障转移
      - DIRECT
      - __WANGWANG_SOURCE_SLOT_full01__
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
    path: ./ruleset/private-domain.mrs
    interval: 86400
  private-ip:
    type: http
    behavior: ipcidr
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/private.mrs"
    path: ./ruleset/private-ip.mrs
    interval: 86400
  category-ai-!cn-domain:
    type: http
    behavior: domain
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/category-ai-!cn.mrs"
    path: ./ruleset/category-ai-!cn-domain.mrs
    interval: 86400
  github-domain:
    type: http
    behavior: domain
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/github.mrs"
    path: ./ruleset/github-domain.mrs
    interval: 86400
  google-domain:
    type: http
    behavior: domain
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/google.mrs"
    path: ./ruleset/google-domain.mrs
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
    path: ./ruleset/telegram-domain.mrs
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
  microsoft@cn-domain:
    type: http
    behavior: domain
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/microsoft@cn.mrs"
    path: ./ruleset/microsoft@cn-domain.mrs
    interval: 86400
  microsoft-domain:
    type: http
    behavior: domain
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/microsoft.mrs"
    path: ./ruleset/microsoft-domain.mrs
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
  games-cn-domain:
    type: http
    behavior: domain
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/category-games@cn.mrs"
    path: ./ruleset/games-cn-domain.mrs
    interval: 86400
  games-domain:
    type: http
    behavior: domain
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/category-games.mrs"
    path: ./ruleset/games-domain.mrs
    interval: 86400
  steam-cn-domain:
    type: http
    behavior: domain
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/steam@cn.mrs"
    path: ./ruleset/steam-cn-domain.mrs
    interval: 86400
  steam-domain:
    type: http
    behavior: domain
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/steam.mrs"
    path: ./ruleset/steam-domain.mrs
    interval: 86400
  cn-domain:
    type: http
    behavior: domain
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/cn.mrs"
    path: ./ruleset/cn-domain.mrs
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

  - RULE-SET,category-ai-!cn-domain,🤖 AI 服务

  - RULE-SET,github-domain,🐱 GitHub

  # YouTube 必须优先于 Google
  - RULE-SET,youtube-domain,🎬 流媒体

  - RULE-SET,google-domain,🔍 Google
  - RULE-SET,google-ip,🔍 Google,no-resolve

  - RULE-SET,telegram-domain,✈️ Telegram
  - RULE-SET,telegram-ip,✈️ Telegram,no-resolve

  - RULE-SET,microsoft@cn-domain,DIRECT
  - RULE-SET,microsoft-domain,Ⓜ️ Microsoft

  - RULE-SET,apple-cn-domain,DIRECT
  - RULE-SET,apple-domain,🍎 Apple

  # 中国大陆游戏 CDN / 服务优先直连
  - RULE-SET,steam-cn-domain,DIRECT
  - RULE-SET,games-cn-domain,DIRECT
  # 其余游戏服务进入游戏平台策略组
  - RULE-SET,steam-domain,🎮 游戏平台
  - RULE-SET,games-domain,🎮 游戏平台

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
    description: '标准超集 / 多服务分流 / IP 规则',
    yaml: fullYaml,
  },
]

export function builtinTemplate(id: string) {
  return builtinTemplates.find((template) => template.id === id)
}
