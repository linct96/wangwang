import type { ProxyConfig } from '../db'
export function normalize(config: ProxyConfig): ProxyConfig {
  return {
    ...config,
    name: String(config.name).trim(),
    type: String(config.type).toLowerCase(),
    server: String(config.server).trim(),
  }
}
