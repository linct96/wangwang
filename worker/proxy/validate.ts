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
  const result = (schemas[config.type] || base).safeParse(config)
  return result.success ? null : result.error.issues[0]?.message || '节点配置无效'
}
