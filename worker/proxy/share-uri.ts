import type { ProxyConfig } from '../db'

function base64(value: string, urlSafe = false) {
  const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(value)))
  return urlSafe ? encoded.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') : encoded
}

function authority(config: ProxyConfig, port: string | number = config.port) {
  const server = config.server.includes(':') && !config.server.startsWith('[') ? `[${config.server}]` : config.server
  return `${server}:${port}`
}

function value(config: ProxyConfig, key: string) {
  return config[key] == null ? '' : String(config[key])
}

function transportParams(config: ProxyConfig, params: URLSearchParams) {
  const network = value(config, 'network') || 'tcp'
  params.set('type', network)
  if (network === 'ws') {
    const options = (config['ws-opts'] || {}) as { path?: string; headers?: { Host?: string } }
    if (options.path) params.set('path', options.path)
    if (options.headers?.Host) params.set('host', options.headers.Host)
  } else if (network === 'grpc') {
    const options = (config['grpc-opts'] || {}) as { 'grpc-service-name'?: string }
    if (options['grpc-service-name']) params.set('serviceName', options['grpc-service-name'])
  } else if (network === 'http') {
    const options = (config['http-opts'] || {}) as { path?: string; headers?: { Host?: string[] } }
    if (options.path) params.set('path', options.path)
    if (options.headers?.Host?.[0]) params.set('host', options.headers.Host[0])
  } else if (network === 'h2') {
    const options = (config['h2-opts'] || {}) as { path?: string; host?: string[] }
    if (options.path) params.set('path', options.path)
    if (options.host?.[0]) params.set('host', options.host[0])
  } else if (network === 'xhttp') {
    const options = (config['xhttp-opts'] || {}) as { path?: string; host?: string; mode?: string }
    if (options.path) params.set('path', options.path)
    if (options.host) params.set('host', options.host)
    if (options.mode) params.set('mode', options.mode)
  }
}

function tlsParams(config: ProxyConfig, params: URLSearchParams) {
  const reality = config['reality-opts'] as { 'public-key'?: string; 'short-id'?: string } | undefined
  const ech = config['ech-opts'] as { config?: string; 'query-server-name'?: string } | undefined
  params.set('security', reality ? 'reality' : config.tls ? 'tls' : 'none')
  if (config.servername) params.set('sni', value(config, 'servername'))
  if (config['client-fingerprint']) params.set('fp', value(config, 'client-fingerprint'))
  if (reality?.['public-key']) params.set('pbk', reality['public-key'])
  if (reality?.['short-id']) params.set('sid', reality['short-id'])
  if (ech?.['query-server-name']) params.set('ech', ech['query-server-name'])
  if (ech?.config) params.set('config', ech.config)
}

function standardUri(config: ProxyConfig, name: string) {
  const params = new URLSearchParams()
  let credentials = ''
  if (config.type === 'vless') {
    credentials = encodeURIComponent(value(config, 'uuid'))
    params.set('encryption', value(config, 'encryption') || 'none')
    if (config.flow) params.set('flow', value(config, 'flow'))
    transportParams(config, params)
    tlsParams(config, params)
  } else if (config.type === 'trojan') {
    credentials = encodeURIComponent(value(config, 'password'))
    transportParams(config, params)
    tlsParams(config, params)
  } else if (config.type === 'tuic') {
    credentials = `${encodeURIComponent(value(config, 'uuid'))}:${encodeURIComponent(value(config, 'password'))}`
    if (config.sni) params.set('sni', value(config, 'sni'))
    if (config['congestion-controller']) params.set('congestion_control', value(config, 'congestion-controller'))
    if (config['udp-relay-mode']) params.set('udp_relay_mode', value(config, 'udp-relay-mode'))
    if (config['skip-cert-verify']) params.set('allow_insecure', '1')
  } else if (config.type === 'hysteria2') {
    credentials = encodeURIComponent(value(config, 'password'))
    if (config.sni) params.set('sni', value(config, 'sni'))
    if (config['skip-cert-verify']) params.set('insecure', '1')
    if (config.obfs) params.set('obfs', value(config, 'obfs'))
    if (config['obfs-password']) params.set('obfs-password', value(config, 'obfs-password'))
    if (config.fingerprint) params.set('pinSHA256', value(config, 'fingerprint'))
    const ech = config['ech-opts'] as { config?: string } | undefined
    if (ech?.config) params.set('ech', ech.config)
  } else {
    credentials = encodeURIComponent(value(config, 'password'))
    if (config.sni) params.set('sni', value(config, 'sni'))
    if (config['skip-cert-verify']) params.set('insecure', '1')
  }
  const port = config.type === 'hysteria2' && config.ports ? value(config, 'ports') : config.port
  return `${config.type}://${credentials}@${authority(config, port)}${params.size ? `?${params}` : ''}#${encodeURIComponent(name)}`
}

function ssUri(config: ProxyConfig, name: string) {
  const credentials = base64(`${value(config, 'cipher')}:${value(config, 'password')}`, true)
  const params = new URLSearchParams()
  if (config.plugin) {
    const escape = (part: string) => part.replaceAll('\\', '\\\\').replaceAll(';', '\\;').replaceAll('=', '\\=')
    const options = Object.entries((config['plugin-opts'] || {}) as Record<string, unknown>)
      .map(([key, option]) => `${escape(key)}=${escape(String(option))}`)
      .join(';')
    params.set('plugin', `${escape(value(config, 'plugin'))}${options ? `;${options}` : ''}`)
  }
  return `ss://${credentials}@${authority(config)}${params.size ? `?${params}` : ''}#${encodeURIComponent(name)}`
}

function vmessUri(config: ProxyConfig, name: string) {
  const network = value(config, 'network') || 'tcp'
  const ws = (config['ws-opts'] || {}) as { path?: string; headers?: { Host?: string } }
  const grpc = (config['grpc-opts'] || {}) as { 'grpc-service-name'?: string }
  const http = (config['http-opts'] || {}) as { path?: string; headers?: { Host?: string[] } }
  const h2 = (config['h2-opts'] || {}) as { path?: string; host?: string[] }
  const raw = {
    v: '2',
    ps: name,
    add: config.server,
    port: String(config.port),
    id: value(config, 'uuid'),
    aid: value(config, 'alterId') || '0',
    scy: value(config, 'cipher') || 'auto',
    net: network,
    type: 'none',
    host: ws.headers?.Host || http.headers?.Host?.[0] || h2.host?.[0] || '',
    path: ws.path || grpc['grpc-service-name'] || http.path || h2.path || '',
    tls: config.tls ? 'tls' : '',
    sni: value(config, 'servername'),
    fp: value(config, 'client-fingerprint'),
  }
  return `vmess://${base64(JSON.stringify(raw))}`
}

export function shareUri(config: ProxyConfig, name = config.name) {
  if (config.type === 'ss') return ssUri(config, name)
  if (config.type === 'vmess') return vmessUri(config, name)
  if (['vless', 'trojan', 'tuic', 'hysteria2', 'anytls'].includes(config.type)) return standardUri(config, name)
  return null
}
