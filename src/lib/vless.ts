import type { ManualNodeConnection } from '@/api/types'

function decode(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new Error('VLESS 链接包含无效编码')
  }
}

function parseVlessLink(input: string): ManualNodeConnection {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new Error('VLESS 链接格式无效')
  }
  if (url.protocol !== 'vless:') throw new Error('仅支持 vless:// 链接')

  const port = Number(url.port)
  const uuid = decode(url.username)
  if (!uuid || !url.hostname || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('VLESS 链接缺少 UUID、服务器或有效端口')

  const network = url.searchParams.get('type') || 'tcp'
  if (!['tcp', 'ws', 'grpc'].includes(network)) throw new Error(`不支持的传输方式：${network}`)
  const security = url.searchParams.get('security') || 'none'
  if (!['none', 'tls', 'reality'].includes(security)) throw new Error(`不支持的传输安全：${security}`)
  if (security === 'reality' && !url.searchParams.get('pbk')) throw new Error('Reality 链接缺少公钥')

  return {
    name: decode(url.hash.slice(1)).trim() || `${url.hostname}:${port}`,
    protocol: 'vless',
    server: url.hostname,
    port,
    uuid,
    network: network as ManualNodeConnection['network'],
    security: security as ManualNodeConnection['security'],
    sni: security === 'none' ? undefined : url.searchParams.get('sni') || url.hostname,
    clientFingerprint: url.searchParams.get('fp') || undefined,
    wsPath: network === 'ws' ? url.searchParams.get('path') || '/' : undefined,
    wsHost: network === 'ws' ? url.searchParams.get('host') || undefined : undefined,
    grpcServiceName: network === 'grpc' ? url.searchParams.get('serviceName') || undefined : undefined,
    realityPublicKey: security === 'reality' ? url.searchParams.get('pbk') || undefined : undefined,
    realityShortId: security === 'reality' ? url.searchParams.get('sid') || undefined : undefined,
    flow: url.searchParams.get('flow') || undefined,
  }
}

export { parseVlessLink }
