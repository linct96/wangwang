import type { ProxyConfig } from '../db'
const canonical = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : value && typeof value === 'object'
      ? `{${Object.entries(value as Record<string, unknown>)
          .filter(([key, item]) => key !== 'name' && item !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
          .join(',')}}`
      : JSON.stringify(value)
export async function fingerprint(config: ProxyConfig) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(config)))
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
