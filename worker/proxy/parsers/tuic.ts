import type { ProxyConfig } from '../../db'
export function parseTuic(url: URL, config: ProxyConfig) {
  config.uuid = decodeURIComponent(url.username)
  config.password = decodeURIComponent(url.password)
  config.sni = url.searchParams.get('sni') || url.hostname
  config['congestion-controller'] = url.searchParams.get('congestion_control') || 'bbr'
  config['udp-relay-mode'] = url.searchParams.get('udp_relay_mode') || 'native'
  config['skip-cert-verify'] = ['1', 'true'].includes(url.searchParams.get('allow_insecure') || '')
}
