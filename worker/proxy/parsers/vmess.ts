import type { ProxyConfig } from '../../db'
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
