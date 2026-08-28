import type { ProxyConfig } from '../../db'
export function parseVless(url: URL, config: ProxyConfig) {
  config.uuid = decodeURIComponent(url.username)
  if (url.searchParams.get('flow')) config.flow = url.searchParams.get('flow')
  const network = url.searchParams.get('type') || url.searchParams.get('network') || 'tcp'
  if (network !== 'tcp') config.network = network
  if (network === 'ws')
    config['ws-opts'] = {
      path: url.searchParams.get('path') || '/',
      headers: url.searchParams.get('host') ? { Host: url.searchParams.get('host') } : undefined,
    }
  if (network === 'grpc') config['grpc-opts'] = { 'grpc-service-name': url.searchParams.get('serviceName') || '' }
  if (network === 'http' || network === 'h2')
    config['http-opts'] = {
      path: url.searchParams.get('path') || '/',
      headers: url.searchParams.get('host') ? { Host: [url.searchParams.get('host')] } : undefined,
    }
  if (network === 'xhttp') {
    config['xhttp-opts'] = {
      path: url.searchParams.get('path') || '/',
      mode: url.searchParams.get('mode') || undefined,
      headers: url.searchParams.get('host') ? { Host: url.searchParams.get('host') } : undefined,
    }
    config['__warning'] = '暂未完整支持的 VLESS transport: xhttp'
  }
  const security = url.searchParams.get('security')
  if (security === 'tls' || security === 'reality' || ['1', 'true'].includes(url.searchParams.get('tls') || '')) {
    config.tls = true
    config.servername = url.searchParams.get('sni') || url.hostname
    if (url.searchParams.get('fp')) config['client-fingerprint'] = url.searchParams.get('fp')
  }
  if (security === 'reality')
    config['reality-opts'] = {
      'public-key': url.searchParams.get('pbk') || '',
      'short-id': url.searchParams.get('sid') || '',
    }
}
