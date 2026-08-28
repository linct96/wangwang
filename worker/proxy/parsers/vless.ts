import type { ProxyConfig } from '../../db'
export function parseVless(url: URL, config: ProxyConfig) {
  config.uuid = decodeURIComponent(url.username)
  if (url.searchParams.get('flow')) config.flow = url.searchParams.get('flow')
}
