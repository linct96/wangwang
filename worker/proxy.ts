import { parse, stringify } from 'yaml'
import type { ProxyConfig, RuleModule } from './db'

const MAX_TEXT_BYTES = 1024 * 1024
const SUPPORTED_SCHEMES = new Set(['ss:', 'vmess:', 'vless:', 'trojan:', 'hysteria2:', 'hy2:', 'tuic:'])
const SECRET_FIELDS = ['password', 'uuid', 'obfs-password'] as const

export type ParsedNode = {
  config: ProxyConfig
  fingerprint: string
}

export type ParseResult = {
  nodes: ParsedNode[]
  warnings: string[]
}

const textDecoder = new TextDecoder()

function decodeBase64(value: string) {
  const normalized = value.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
  return textDecoder.decode(bytes)
}

function nameFromUrl(url: URL, fallback: string) {
  return decodeURIComponent(url.hash.slice(1)).trim() || fallback
}

function requiredPort(url: URL) {
  const port = Number(url.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口无效')
  return port
}

function bool(value: string | null) {
  return value === '1' || value === 'true'
}

function networkOptions(url: URL, config: ProxyConfig) {
  const network = url.searchParams.get('type') || url.searchParams.get('network')
  if (!network || network === 'tcp') return
  config.network = network
  if (network === 'ws') {
    config['ws-opts'] = {
      path: url.searchParams.get('path') || '/',
      headers: url.searchParams.get('host') ? { Host: url.searchParams.get('host') } : undefined,
    }
  }
  if (network === 'grpc') {
    config['grpc-opts'] = { 'grpc-service-name': url.searchParams.get('serviceName') || '' }
  }
}

function tlsOptions(url: URL, config: ProxyConfig) {
  const security = url.searchParams.get('security')
  if (security === 'tls' || security === 'reality' || bool(url.searchParams.get('tls'))) {
    config.tls = true
    config.servername = url.searchParams.get('sni') || url.hostname
    if (url.searchParams.get('fp')) config['client-fingerprint'] = url.searchParams.get('fp')
  }
  if (security === 'reality') {
    config['reality-opts'] = {
      'public-key': url.searchParams.get('pbk') || '',
      'short-id': url.searchParams.get('sid') || '',
    }
  }
}

function parseSs(input: string): ProxyConfig {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error('SS 链接格式无效')
  }

  if (!url.hostname) {
    const [payload, fragment = ''] = input.slice(5).split('#', 2)
    url = new URL(`ss://${decodeBase64(payload)}#${fragment}`)
  }

  let credentials = decodeURIComponent(url.username)
  if (!credentials.includes(':')) credentials = decodeBase64(credentials)
  const separator = credentials.indexOf(':')
  if (separator < 1) throw new Error('SS 认证信息无效')

  const config: ProxyConfig = {
    name: nameFromUrl(url, `${url.hostname}:${url.port}`),
    type: 'ss',
    server: url.hostname,
    port: requiredPort(url),
    cipher: credentials.slice(0, separator),
    password: credentials.slice(separator + 1),
    udp: true,
  }
  const plugin = url.searchParams.get('plugin')
  if (plugin) {
    const [pluginName, ...options] = plugin.split(';')
    config.plugin = pluginName
    config['plugin-opts'] = Object.fromEntries(options.map((item) => item.split('=', 2)))
  }
  return config
}

function parseVmess(input: string): ProxyConfig {
  const raw = JSON.parse(decodeBase64(input.slice('vmess://'.length))) as Record<string, unknown>
  const server = String(raw.add || '')
  const port = Number(raw.port)
  if (!server || !Number.isInteger(port) || !raw.id) throw new Error('VMess 必填字段缺失')
  const config: ProxyConfig = {
    name: String(raw.ps || `${server}:${port}`),
    type: 'vmess',
    server,
    port,
    uuid: String(raw.id),
    alterId: Number(raw.aid || 0),
    cipher: String(raw.scy || 'auto'),
    udp: true,
  }
  const network = String(raw.net || 'tcp')
  if (network !== 'tcp') config.network = network
  if (network === 'ws') {
    config['ws-opts'] = { path: String(raw.path || '/'), headers: raw.host ? { Host: String(raw.host) } : undefined }
  }
  if (network === 'grpc') config['grpc-opts'] = { 'grpc-service-name': String(raw.path || '') }
  if (String(raw.tls || '') === 'tls') {
    config.tls = true
    config.servername = String(raw.sni || raw.host || server)
    if (raw.fp) config['client-fingerprint'] = String(raw.fp)
  }
  return config
}

function parseStandardUrl(input: string): ProxyConfig {
  const url = new URL(input)
  const type = url.protocol.slice(0, -1) === 'hy2' ? 'hysteria2' : url.protocol.slice(0, -1)
  const base: ProxyConfig = {
    name: nameFromUrl(url, `${url.hostname}:${url.port}`),
    type,
    server: url.hostname,
    port: requiredPort(url),
    udp: true,
  }

  if (type === 'vless') {
    base.uuid = decodeURIComponent(url.username)
    if (url.searchParams.get('flow')) base.flow = url.searchParams.get('flow')
    networkOptions(url, base)
    tlsOptions(url, base)
  } else if (type === 'trojan') {
    base.password = decodeURIComponent(url.username)
    networkOptions(url, base)
    tlsOptions(url, base)
  } else if (type === 'hysteria2') {
    base.password = decodeURIComponent(url.username || url.searchParams.get('auth') || '')
    base.sni = url.searchParams.get('sni') || url.hostname
    base['skip-cert-verify'] = bool(url.searchParams.get('insecure'))
    if (url.searchParams.get('obfs')) base.obfs = url.searchParams.get('obfs')
    if (url.searchParams.get('obfs-password')) base['obfs-password'] = url.searchParams.get('obfs-password')
  } else if (type === 'tuic') {
    base.uuid = decodeURIComponent(url.username)
    base.password = decodeURIComponent(url.password)
    base.sni = url.searchParams.get('sni') || url.hostname
    base['congestion-controller'] = url.searchParams.get('congestion_control') || 'bbr'
    base['udp-relay-mode'] = url.searchParams.get('udp_relay_mode') || 'native'
    base['skip-cert-verify'] = bool(url.searchParams.get('allow_insecure'))
  }

  return base
}

function parseUri(input: string) {
  const scheme = input.slice(0, input.indexOf(':') + 1).toLowerCase()
  if (!SUPPORTED_SCHEMES.has(scheme)) throw new Error('协议不支持')
  if (scheme === 'ss:') return parseSs(input)
  if (scheme === 'vmess:') return parseVmess(input)
  return parseStandardUrl(input)
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([key, item]) => key !== 'name' && item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export async function fingerprint(config: ProxyConfig) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(config)))
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function yamlNodes(text: string): ProxyConfig[] | null {
  const document = parse(text, { maxAliasCount: 20 }) as unknown
  if (!Array.isArray(document)) return null
  return document.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('YAML 节点不是对象')
    const proxy = { ...(item as Record<string, unknown>) }
    const port = Number(proxy.port)
    if (!proxy.name || !proxy.type || !proxy.server || !Number.isInteger(port)) throw new Error('YAML 节点必填字段缺失')
    return {
      ...proxy,
      name: String(proxy.name),
      type: String(proxy.type).toLowerCase(),
      server: String(proxy.server),
      port,
    } as ProxyConfig
  })
}

export async function parseProxyText(text: string): Promise<ParseResult> {
  if (!text.trim()) throw new Error('节点内容为空')
  if (new TextEncoder().encode(text).byteLength > MAX_TEXT_BYTES) throw new Error('节点内容超过 1 MiB')

  let configs: ProxyConfig[] = []
  const warnings: string[] = []
  try {
    configs = yamlNodes(text) || []
  } catch (error) {
    if (/^\s*-\s+/m.test(text)) throw new Error(`YAML 解析失败：${error instanceof Error ? error.message : '格式错误'}`)
  }

  if (!configs.length) {
    let content = text.trim()
    if (!content.includes('://')) {
      try {
        content = decodeBase64(content)
      } catch {
        throw new Error('未识别到 Mihomo YAML 或节点 URI')
      }
    }
    for (const [index, line] of content.split(/\r?\n/).entries()) {
      const value = line.trim()
      if (!value) continue
      try {
        configs.push(parseUri(value))
      } catch (error) {
        if (warnings.length < 20)
          warnings.push(`第 ${index + 1} 行：${error instanceof Error ? error.message : '格式错误'}`)
      }
    }
  }

  const deduplicated = new Map<string, ParsedNode>()
  for (const config of configs) {
    const value = await fingerprint(config)
    if (!deduplicated.has(value)) deduplicated.set(value, { config, fingerprint: value })
  }
  if (!deduplicated.size) throw new Error(warnings[0] || '没有可用节点')
  return { nodes: [...deduplicated.values()], warnings }
}

export function editableProxyYaml(config: ProxyConfig) {
  const editable = { ...config }
  for (const field of SECRET_FIELDS) if (field in editable) editable[field] = ''
  return stringify([editable], { lineWidth: 0 })
}

export function restoreProxySecrets(config: ProxyConfig, current: ProxyConfig) {
  const restored = { ...config }
  if (restored.type !== current.type) return restored
  for (const field of SECRET_FIELDS)
    if ((restored[field] === '' || restored[field] === undefined) && current[field] !== undefined)
      restored[field] = current[field]
  return restored
}

export function proxyConfigError(config: ProxyConfig) {
  if (!config.name || !config.server) return '节点名称或服务器不能为空'
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) return '端口必须是 1 到 65535 的整数'
  if (config.type === 'ss' && (!config.cipher || !config.password)) return 'SS 节点缺少加密方式或密码'
  if ((config.type === 'vmess' || config.type === 'vless') && !config.uuid) return `${config.type} 节点缺少 UUID`
  if ((config.type === 'trojan' || config.type === 'hysteria2') && !config.password)
    return `${config.type} 节点缺少密码`
  if (config.type === 'tuic' && (!config.uuid || !config.password)) return 'TUIC 节点缺少 UUID 或密码'
  const reality = config['reality-opts'] as { 'public-key'?: unknown } | undefined
  if (reality && !reality['public-key']) return 'Reality 节点缺少公钥'
  return null
}

const RULES: Record<RuleModule, string[]> = {
  ads: ['GEOSITE,category-ads-all,REJECT'],
  private: ['GEOSITE,private,DIRECT', 'GEOIP,private,DIRECT,no-resolve'],
  cn: ['GEOSITE,cn,DIRECT', 'GEOIP,CN,DIRECT,no-resolve'],
}

export function generateMihomoConfig(
  inputNodes: Array<{ config: ProxyConfig; name: string }>,
  options: { dnsMode: 'fake-ip' | 'redir-host'; ruleModules: RuleModule[] },
) {
  if (!inputNodes.length) throw new Error('配置没有可用节点')
  if (inputNodes.length > 1000) throw new Error('单个配置最多包含 1000 个节点')

  const seen = new Map<string, number>()
  const proxies = inputNodes.map(({ config, name }) => {
    const base = name.trim() || `${config.server}:${config.port}`
    const count = (seen.get(base) || 0) + 1
    seen.set(base, count)
    return { ...config, name: count === 1 ? base : `${base}-${count}` }
  })
  const names = proxies.map((proxy) => proxy.name)
  const url = 'https://www.gstatic.com/generate_204'
  const rules = options.ruleModules.flatMap((module) => RULES[module] || [])
  rules.push('MATCH,节点选择')

  const output = stringify(
    {
      'mixed-port': 7890,
      'allow-lan': false,
      mode: 'rule',
      'log-level': 'info',
      ipv6: false,
      'unified-delay': true,
      dns: {
        enable: true,
        ipv6: false,
        'enhanced-mode': options.dnsMode,
        'fake-ip-range': '198.18.0.1/16',
        'default-nameserver': ['223.5.5.5', '1.1.1.1'],
        nameserver: ['https://dns.alidns.com/dns-query', 'https://1.1.1.1/dns-query'],
      },
      proxies,
      'proxy-groups': [
        { name: '节点选择', type: 'select', proxies: ['自动选择', '故障转移', ...names, 'DIRECT'] },
        { name: '自动选择', type: 'url-test', url, interval: 300, tolerance: 50, proxies: names },
        { name: '故障转移', type: 'fallback', url, interval: 300, proxies: names },
      ],
      rules,
    },
    { lineWidth: 0 },
  )
  if (new TextEncoder().encode(output).byteLength > MAX_TEXT_BYTES) throw new Error('生成配置超过 1 MiB')
  return output
}
