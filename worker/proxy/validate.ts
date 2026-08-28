import { z } from 'zod'
import type { ProxyConfig } from '../db'
const base = z
  .object({
    name: z.string().min(1),
    type: z.string().min(1),
    server: z.string().min(1),
    port: z.number().int().min(1).max(65535),
  })
  .passthrough()
const schemas: Record<string, typeof base> = {
  ss: base.extend({ cipher: z.string().min(1), password: z.string().min(1) }),
  vmess: base.extend({ uuid: z.string().min(1) }),
  vless: base.extend({ uuid: z.string().min(1) }),
  trojan: base.extend({ password: z.string().min(1) }),
  hysteria2: base.extend({ password: z.string().min(1) }),
  tuic: base.extend({ uuid: z.string().min(1), password: z.string().min(1) }),
  anytls: base.extend({ password: z.string().min(1) }),
}
export function validate(config: ProxyConfig): string | null {
  const required: Record<string, string> = {
    ss: 'cipher',
    vmess: 'uuid',
    vless: 'uuid',
    trojan: 'password',
    hysteria2: 'password',
    tuic: 'uuid',
    anytls: 'password',
  }
  const field = required[config.type]
  if (!config.name) return '缺少 name'
  if (!config.server) return '缺少 server'
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) return '缺少或无效 port'
  if ((field && typeof config[field] !== 'string') || (field && !String(config[field] || '').trim()))
    return `${config.type.toUpperCase()} 缺少 ${field}`
  const result = (schemas[config.type] || base).safeParse(config)
  return result.success ? null : result.error.issues[0]?.message || '节点配置无效'
}
