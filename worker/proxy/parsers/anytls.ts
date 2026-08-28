import type { ProxyConfig } from '../../db'
export function parseAnytls(url: URL, config: ProxyConfig) {
  config.password = decodeURIComponent(url.username)
  config.sni = url.searchParams.get('sni') || url.hostname
  config['skip-cert-verify'] = url.searchParams.get('insecure') === '1' || url.searchParams.get('insecure') === 'true'
}
