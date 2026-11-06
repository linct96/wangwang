import type { ProxyConfig } from '../../db'
import { parseTransport } from './transport'
export function parseVless(url: URL, config: ProxyConfig) {
  config.uuid = decodeURIComponent(url.username)
  if (url.searchParams.get('flow')) config.flow = url.searchParams.get('flow')
  if (url.searchParams.has('encryption')) config.encryption = url.searchParams.get('encryption') ?? ''
  const network = url.searchParams.get('type') || url.searchParams.get('network') || 'tcp'
  parseTransport(config, {
    network,
    path: url.searchParams.get('path') || undefined,
    host: url.searchParams.get('host') || undefined,
    serviceName: url.searchParams.get('serviceName') || undefined,
  })
  if (network === 'xhttp') {
    config['xhttp-opts'] = {
      path: url.searchParams.get('path') || '/',
      host: url.searchParams.get('host') || undefined,
      mode: url.searchParams.get('mode') || undefined,
    }
  }
  const security = url.searchParams.get('security')
  if (security === 'tls' || security === 'reality' || ['1', 'true'].includes(url.searchParams.get('tls') || '')) {
    config.tls = true
    config.servername = url.searchParams.get('sni') || url.hostname
    if (url.searchParams.get('fp')) config['client-fingerprint'] = url.searchParams.get('fp')
    const alpn = url.searchParams.get('alpn')
    if (alpn !== null) {
      const protocols = alpn.split(',')
      if (protocols.some((protocol) => !protocol || /\s/.test(protocol)))
        throw new Error('ALPN 协议名不能为空，多个协议须用英文逗号分隔且不含空格')
      config.alpn = protocols
    }
  }
  if (security === 'reality')
    config['reality-opts'] = {
      'public-key': url.searchParams.get('pbk') || '',
      'short-id': url.searchParams.get('sid') || '',
    }
  const ech = url.searchParams.get('ech')
  if (ech)
    config['ech-opts'] = {
      enable: true,
      ...(url.searchParams.has('config') ? { config: url.searchParams.get('config') ?? '' } : {}),
      'query-server-name': ech.split('+', 1)[0],
    }
}
