import type { ProxyConfig } from '../../db'
import { parseTransport } from './transport'
function decode(value: string) {
  const normalized = value
    .replace(/\s/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(normalized), (c) => c.charCodeAt(0)))) as Record<
    string,
    unknown
  >
}
export function parseVmessConfig(raw: Record<string, unknown>): ProxyConfig {
  const server = String(raw.add || ''),
    port = Number(raw.port)
  if (!server || !Number.isInteger(port) || !raw.id) throw new Error('VMess 必填字段缺失')
  return {
    name: String(raw.ps || `${server}:${port}`),
    type: 'vmess',
    server,
    port,
    uuid: String(raw.id),
    alterId: Number(raw.aid || 0),
    cipher: String(raw.scy || 'auto'),
    udp: true,
  }
}
export function parseVmess(input: string): ProxyConfig {
  const raw = decode(input.slice('vmess://'.length))
  const config = parseVmessConfig(raw),
    network = String(raw.net || 'tcp')
  parseTransport(config, {
    network,
    path: String(raw.path || '/') || undefined,
    host: raw.host ? String(raw.host) : undefined,
    serviceName: String(raw.path || '') || undefined,
  })
  if (String(raw.tls || '') === 'tls') {
    config.tls = true
    config.servername = String(raw.sni || raw.host || config.server)
    if (raw.fp) config['client-fingerprint'] = String(raw.fp)
  }
  return config
}
