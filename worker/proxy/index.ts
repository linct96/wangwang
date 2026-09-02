import { parse, stringify } from 'yaml'
import type { ProxyConfig } from '../db'
import { parseAnytls } from './parsers/anytls'
import { parseHysteria2 as parseHysteria2Uri } from './parsers/hysteria2'
import { parseTuic } from './parsers/tuic'
import { parseTrojan } from './parsers/trojan'
import { parseVless } from './parsers/vless'
import { parseSs } from './parsers/ss'
import { parseVmess } from './parsers/vmess'
import { normalize } from './normalize'
import { fingerprint as fingerprintNode } from './fingerprint'
import { validate } from './validate'
import { detectFormat } from './subscription'

const MAX_TEXT_BYTES = 1024 * 1024
const SUPPORTED_SCHEMES = new Set(['ss:', 'vmess:', 'vless:', 'trojan:', 'hysteria2:', 'hy2:', 'tuic:', 'anytls:'])
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

function decodeSubscription(text: string) {
  const format = detectFormat(text)
  if (format !== 'base64') return { content: text, format }
  const content = decodeBase64(text)
  return { content, format: detectFormat(content) }
}

function nameFromUrl(url: URL, fallback: string) {
  return decodeURIComponent(url.hash.slice(1)).trim() || fallback
}

function requiredPort(url: URL, fallback?: number) {
  const port = Number(url.port)
  if (!url.port && fallback) return fallback
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口无效')
  return port
}

function bool(value: string | null) {
  return value === '1' || value === 'true'
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

function parseStandardUrl(input: string): ProxyConfig {
  const url = new URL(input)
  const type = url.protocol.slice(0, -1) === 'hy2' ? 'hysteria2' : url.protocol.slice(0, -1)
  const base: ProxyConfig = {
    name: nameFromUrl(url, `${url.hostname}:${url.port}`),
    type,
    server: url.hostname,
    port: requiredPort(url, type === 'anytls' ? 443 : undefined),
    udp: true,
  }

  if (type === 'vless') parseVless(url, base)
  else if (type === 'trojan') parseTrojan(url, base)
  else if (type === 'tuic') parseTuic(url, base)
  else if (type === 'anytls') parseAnytls(url, base)
  if (type === 'trojan') {
    tlsOptions(url, base)
  }

  return base
}

function parseUri(input: string) {
  const scheme = input.slice(0, input.indexOf(':') + 1).toLowerCase()
  if (!SUPPORTED_SCHEMES.has(scheme)) throw new Error('协议不支持')
  if (scheme === 'ss:') return parseSs(input)
  if (scheme === 'vmess:') return parseVmess(input)
  if (scheme === 'hysteria2:' || scheme === 'hy2:') return parseHysteria2Uri(input)
  return parseStandardUrl(input)
}

export async function fingerprint(config: ProxyConfig) {
  return fingerprintNode(config)
}

function yamlNodes(text: string): ProxyConfig[] | null {
  const document = parse(text, { maxAliasCount: 20 }) as unknown
  const items =
    document && typeof document === 'object' && Array.isArray((document as { proxies?: unknown }).proxies)
      ? (document as { proxies: unknown[] }).proxies
      : Array.isArray(document)
        ? document
        : null
  if (!items) return null
  return items.map((item, index) => {
    if (!item || typeof item !== 'object')
      return {
        name: '',
        type: '',
        server: '',
        port: Number.NaN,
        __warning: `YAML 第 ${index + 1} 个节点不是对象`,
      } as ProxyConfig
    const proxy = { ...(item as Record<string, unknown>) }
    const port = Number(proxy.port)
    const normalized = normalize({ ...proxy, port } as ProxyConfig)
    return normalized
  })
}

export function parseEditableProxyYaml(text: string): ProxyConfig {
  if (!text.trim()) throw new Error('节点内容为空')
  if (new TextEncoder().encode(text).byteLength > MAX_TEXT_BYTES) throw new Error('节点内容超过 1 MiB')
  const document = parse(text, { maxAliasCount: 20 }) as unknown
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('YAML 必须是单个节点对象')
  const proxy = document as Record<string, unknown>
  return normalize({ ...proxy, port: Number(proxy.port) } as ProxyConfig)
}

export async function parseProxyText(text: string, nodeNameFilter: string | null = null): Promise<ParseResult> {
  if (!text.trim()) throw new Error('节点内容为空')
  if (new TextEncoder().encode(text).byteLength > MAX_TEXT_BYTES) throw new Error('节点内容超过 1 MiB')

  let configs: ProxyConfig[] = []
  const warnings: string[] = []
  let content = text.trim()
  let format = detectFormat(content)
  if (format === 'base64' && !content.includes('://')) {
    try {
      const decoded = decodeSubscription(content)
      content = decoded.content
      format = decoded.format
    } catch {
      throw new Error('未识别到 Mihomo YAML 或节点 URI')
    }
  }
  try {
    configs = yamlNodes(content) || []
  } catch (error) {
    if (format === 'yaml') throw new Error(`YAML 解析失败：${error instanceof Error ? error.message : '格式错误'}`)
  }

  if (!configs.length) {
    for (const [index, line] of content.split(/\r?\n/).entries()) {
      const value = line.trim()
      if (!value) continue
      try {
        configs.push(normalize(parseUri(value)))
      } catch (error) {
        if (warnings.length < 20)
          warnings.push(`第 ${index + 1} 行：${error instanceof Error ? error.message : '格式错误'}`)
      }
    }
  }

  const filter = nodeNameFilter ? new RegExp(nodeNameFilter) : null
  const deduplicated = new Map<string, ParsedNode>()
  for (const config of configs) {
    if (filter?.test(config.name)) continue
    if (config.__warning) {
      if (warnings.length < 20)
        warnings.push(config.name ? `节点 "${config.name}"：${String(config.__warning)}` : String(config.__warning))
      delete config.__warning
    }
    const validationError = validate(config)
    if (validationError) {
      if (warnings.length < 20) warnings.push(`节点 "${config.name || '未命名'}"：${validationError}`)
      continue
    }
    const value = await fingerprint(config)
    deduplicated.set(value, { config, fingerprint: value })
  }
  if (!deduplicated.size) throw new Error(warnings[0] || '没有可用节点')
  return { nodes: [...deduplicated.values()], warnings }
}

export function editableProxyYaml(config: ProxyConfig) {
  return stringify(config, { lineWidth: 0 })
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
  return validate(config)
}
