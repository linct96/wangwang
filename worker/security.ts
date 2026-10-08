export function validOrigin(request: Request) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return true
  const url = new URL(request.url)
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return true
  const origin = request.headers.get('Origin')
  return origin === url.origin
}

const passwordIterations = 100_000
const sessionTtl = 7 * 24 * 60 * 60 * 1000

function bytesToBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
}
function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
}

export async function hashPassword(password: string, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: passwordIterations, hash: 'SHA-256' },
    key,
    256,
  )
  return { salt: bytesToBase64(salt), hash: bytesToBase64(new Uint8Array(bits)) }
}

export async function verifyPassword(password: string, salt: string, expected: string) {
  const actual = await hashPassword(password, base64ToBytes(salt))
  return constantTimeEqual(actual.hash, expected)
}

export async function sessionHash(token: string) {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
}

export function newSessionToken() {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(32)))
}
export const SESSION_TTL = sessionTtl

function toHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function signSubscriptionPayload(secret: string, payload: string) {
  if (!secret) throw new Error('SUBSCRIPTION_TOKEN_SECRET 未配置')
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)))
}

export async function subscriptionToken(secret: string, profileId: string, tokenVersion: number) {
  const signature = await signSubscriptionPayload(secret, `${profileId}:${tokenVersion}`)
  return base64Url(signature.slice(0, 16))
}

export const subscriptionTokenHash = sessionHash

export function validSubscriptionToken(token: string) {
  return /^[A-Za-z0-9_-]{22}$/.test(token)
}

export async function verifySubscriptionToken(secret: string, token: string, profileId: string, tokenVersion: number) {
  if (!validSubscriptionToken(token)) return false
  return constantTimeEqual(await subscriptionToken(secret, profileId, tokenVersion), token)
}

export function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false
  let result = 0
  for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return result === 0
}

function blockedIpv4(a: number, b: number) {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  )
}

export function assertRemoteUrl(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('订阅 URL 无效')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('订阅 URL 仅允许 HTTP/HTTPS 且不能包含用户信息')

  // URL 已规范化 IP（含 IPv4 简写/整数和 IPv6 压缩）；这里只判断字面主机，不解析 DNS。
  const host = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
  const ipv4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host)
  const mappedIpv4 = /^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/.exec(host)
  const mappedPrefix = mappedIpv4 ? Number.parseInt(mappedIpv4[1], 16) : null
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    /^::(?:[\da-f]{1,4}(?::[\da-f]{1,4})?)?$/.test(host) ||
    /^(?:fe[89ab][\da-f]|f[cd][\da-f]{2}|ff[\da-f]{2}):/.test(host) ||
    (ipv4 && blockedIpv4(Number(ipv4[1]), Number(ipv4[2]))) ||
    (mappedPrefix !== null && blockedIpv4(mappedPrefix >>> 8, mappedPrefix & 255))
  ) {
    throw new Error('订阅 URL 不能指向本地或私有地址')
  }
  return url
}
