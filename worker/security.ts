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

// 手动设置订阅令牌；修改后重新部署 Worker。
const subscriptionTokenValue = 'change-this-subscription-token'
export function subscriptionToken() {
  return subscriptionTokenValue
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
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('订阅 URL 仅允许 HTTP/HTTPS 且不能包含用户信息')

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host === '::1' ||
    host.startsWith('fe80:') ||
    host.startsWith('fc') ||
    host.startsWith('fd')
  ) {
    throw new Error('订阅 URL 不能指向本地或私有地址')
  }
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (match) {
    const octets = match.slice(1).map(Number)
    if (octets.some((item) => item > 255)) throw new Error('订阅 URL IP 无效')
    const [a, b] = octets
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    ) {
      throw new Error('订阅 URL 不能指向本地或私有地址')
    }
  }
  return url
}
