import type { ProxyConfig } from '../../db'
function decode(value: string) {
  const normalized = value
    .replace(/\s/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')
  return atob(normalized)
}
export function parseSsConfig(url: URL, credentials: string): ProxyConfig {
  const separator = credentials.indexOf(':')
  if (separator < 1) throw new Error('SS 认证信息无效')
  const config: ProxyConfig = {
    name: decodeURIComponent(url.hash.slice(1)).trim() || `${url.hostname}:${url.port}`,
    type: 'ss',
    server: url.hostname,
    port: Number(url.port),
    cipher: credentials.slice(0, separator),
    password: credentials.slice(separator + 1),
    udp: true,
  }
  return config
}

export function parseSip002Plugin(value: string): { name: string; options: Record<string, string> } {
  const parts: string[] = []
  let current = '',
    escaped = false
  for (const char of value) {
    if (escaped) {
      current += char
      escaped = false
    } else if (char === '\\') escaped = true
    else if (char === ';') {
      parts.push(current)
      current = ''
    } else current += char
  }
  if (escaped) current += '\\'
  parts.push(current)
  const [name = '', ...rest] = parts
  const options: Record<string, string> = {}
  for (const item of rest) {
    let i = -1,
      escapedItem = false
    for (let n = 0; n < item.length; n++) {
      if (escapedItem) {
        escapedItem = false
        continue
      }
      if (item[n] === '\\') {
        escapedItem = true
        continue
      }
      if (item[n] === '=') {
        i = n
        break
      }
    }
    if (i > 0) options[item.slice(0, i)] = item.slice(i + 1)
  }
  return { name, options }
}

export function parseSs(input: string): ProxyConfig {
  let url = new URL(input)
  if (!url.hostname) {
    const [payload, fragment = ''] = input.slice(5).split('#', 2)
    url = new URL(`ss://${decode(payload)}#${fragment}`)
  }
  let credentials = decodeURIComponent(url.username)
  if (!credentials.includes(':')) credentials = decode(credentials)
  const config = parseSsConfig(url, credentials)
  const plugin = url.searchParams.get('plugin')
  if (plugin) {
    const parsed = parseSip002Plugin(plugin)
    config.plugin = parsed.name
    config['plugin-opts'] = parsed.options
  }
  return config
}
