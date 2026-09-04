import type { PhysicalProxyConfig, ProxyConfig } from '../db'

export function splitProxyConfig(config: ProxyConfig): {
  originalName: string
  config: PhysicalProxyConfig
} {
  const { name, ...physical } = config
  return { originalName: name, config: physical as PhysicalProxyConfig }
}

export function namedProxyConfig(config: PhysicalProxyConfig, name: string): ProxyConfig {
  return { ...config, name }
}
