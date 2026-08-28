import type { ProxyConfig } from '../../db'
export function parseSsConfig(url: URL, credentials: string): ProxyConfig {
  const separator = credentials.indexOf(':')
  if (separator < 1) throw new Error('SS 认证信息无效')
  const config: ProxyConfig = {
    name: decodeURIComponent(url.hash.slice(1)).trim() || `${url.hostname}:${url.port}`,
    type: 'ss',
    server: url.hostname,
    port: Number(url.port),
    cipher: credentials.slice(0, separator),
    password: credentials.slice(separator + 1),
    udp: true,
  }
  return config
}
