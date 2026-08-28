import type { ProxyConfig } from '../../db'
export function parseTrojan(url: URL, config: ProxyConfig) {
  config.password = decodeURIComponent(url.username)
}
