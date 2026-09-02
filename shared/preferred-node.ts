export type PreferredEndpoint = {
  server: string
  port?: number
  name: string
}

export function parsePreferredEndpoint(value: string): PreferredEndpoint {
  const input = value.trim()
  const separator = input.indexOf('#')
  const target = (separator < 0 ? input : input.slice(0, separator)).trim()
  const name = separator < 0 ? '' : input.slice(separator + 1).trim()
  if (!target) throw new Error('优选地址不能为空')
  if (target.length > 255) throw new Error('优选地址不能超过 255 个字符')
  if (separator >= 0 && !name) throw new Error(`优选域名名称不能为空：${value}`)
  if (name.length > 80) throw new Error(`优选域名名称不能超过 80 个字符：${name}`)

  try {
    const colonCount = target.match(/:/g)?.length || 0
    const wrapped = colonCount > 1 && !target.startsWith('[') ? `[${target}]` : target
    const parsed = new URL(`tcp://${wrapped}`)
    if (parsed.username || parsed.password || parsed.pathname || parsed.search || parsed.hash) throw new Error()
    const server = parsed.hostname.replace(/^\[|\]$/g, '')
    const port = parsed.port ? Number(parsed.port) : undefined
    if (!server || (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535))) throw new Error()
    return { server, port, name: name || `${server}${port ? `:${port}` : ''}` }
  } catch {
    throw new Error(`优选地址无效：${target}`)
  }
}
