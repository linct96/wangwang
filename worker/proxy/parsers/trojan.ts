import type { ProxyConfig } from '../../db'
import { parseTransport } from './transport'
export function parseTrojan(url: URL, config: ProxyConfig) {
  config.password = decodeURIComponent(url.username)
  parseTransport(config, {
    network: url.searchParams.get('type') || url.searchParams.get('network') || 'tcp',
    path: url.searchParams.get('path') || undefined,
    host: url.searchParams.get('host') || undefined,
    serviceName: url.searchParams.get('serviceName') || undefined,
  })
}
