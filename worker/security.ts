import { createRemoteJWKSet, jwtVerify } from 'jose'

const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function teamDomain(value: string) {
  return value.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

export async function verifyAccess(request: Request, env: Env) {
  const hostname = new URL(request.url).hostname
  if (hostname === 'localhost' || hostname === '127.0.0.1') return true
  const token = request.headers.get('Cf-Access-Jwt-Assertion')
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return false

  const domain = teamDomain(env.ACCESS_TEAM_DOMAIN)
  let keySet = jwks.get(domain)
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL(`https://${domain}/cdn-cgi/access/certs`))
    jwks.set(domain, keySet)
  }
  try {
    await jwtVerify(token, keySet, {
      issuer: `https://${domain}`,
      audience: env.ACCESS_AUD,
    })
    return true
  } catch {
    return false
  }
}

export function validOrigin(request: Request) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return true
  const url = new URL(request.url)
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return true
  const origin = request.headers.get('Origin')
  return origin === url.origin
}

function toHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function subscriptionToken(secret: string, profileId: string, version: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${profileId}:${version}`)))
}

export function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false
  let result = 0
  for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return result === 0
}

export function assertRemoteUrl(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('订阅 URL 无效')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('订阅 URL 仅允许 HTTP/HTTPS 且不能包含用户信息')

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.local') || host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) {
    throw new Error('订阅 URL 不能指向本地或私有地址')
  }
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (match) {
    const octets = match.slice(1).map(Number)
    if (octets.some((item) => item > 255)) throw new Error('订阅 URL IP 无效')
    const [a, b] = octets
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
      throw new Error('订阅 URL 不能指向本地或私有地址')
    }
  }
  return url
}
