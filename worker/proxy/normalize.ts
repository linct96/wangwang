import type { ProxyConfig } from '../db'
export function normalize(config: ProxyConfig): ProxyConfig {
  const normalized: ProxyConfig = {
    ...config,
    name: config.name == null ? '' : String(config.name).trim(),
    type: config.type == null ? '' : String(config.type).toLowerCase(),
    server: config.server == null ? '' : String(config.server).trim(),
  }
  if (normalized.type === 'hy2') normalized.type = 'hysteria2'
  const reality = normalized['reality-opts']
  if (normalized.type === 'vless' && reality && typeof reality === 'object' && !Array.isArray(reality))
    normalized['reality-opts'] = { 'support-x25519mlkem768': true, ...reality }
  if (normalized.network === 'tcp') delete normalized.network
  if (normalized.udp === false) delete normalized.udp
  for (const key of Object.keys(normalized))
    if (normalized[key] === '' || normalized[key] == null) delete normalized[key]
  return normalized
}
