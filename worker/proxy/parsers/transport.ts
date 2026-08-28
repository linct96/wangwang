import type { ProxyConfig } from '../../db'

export type TransportOptions = {
  network: string
  path?: string
  host?: string
  serviceName?: string
}

export function parseWsTransport(config: ProxyConfig, options: TransportOptions) {
  config.network = 'ws'
  config['ws-opts'] = {
    path: options.path || '/',
    headers: options.host ? { Host: options.host } : undefined,
  }
}

export function parseGrpcTransport(config: ProxyConfig, options: TransportOptions) {
  config.network = 'grpc'
  config['grpc-opts'] = { 'grpc-service-name': options.serviceName || options.path || '' }
}

export function parseHttpTransport(config: ProxyConfig, options: TransportOptions) {
  config.network = 'http'
  config['http-opts'] = {
    path: options.path || '/',
    headers: options.host ? { Host: [options.host] } : undefined,
  }
}

export function parseH2Transport(config: ProxyConfig, options: TransportOptions) {
  config.network = 'h2'
  config['h2-opts'] = {
    path: options.path || '/',
    host: options.host ? [options.host] : undefined,
  }
}

export function parseTransport(config: ProxyConfig, options: TransportOptions) {
  if (options.network === 'ws') parseWsTransport(config, options)
  else if (options.network === 'grpc') parseGrpcTransport(config, options)
  else if (options.network === 'http') parseHttpTransport(config, options)
  else if (options.network === 'h2') parseH2Transport(config, options)
  else if (options.network !== 'tcp') config.network = options.network
}
