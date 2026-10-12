import { parse } from 'yaml'
import { validateTemplateSourceSlots, type TemplateSourceSlot } from './source-slots'
export const MAX_TEMPLATE_BYTES = 1024 * 1024

export type MihomoTemplateConfig = Record<string, unknown>

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function assertNoPlaceholder(value: unknown) {
  if (typeof value === 'string' && value.includes('__WANGWANG_')) throw new Error(`占位符位置或名称无效：${value}`)
  if (Array.isArray(value)) value.forEach(assertNoPlaceholder)
  else if (object(value))
    Object.entries(value).forEach(([key, item]) => {
      assertNoPlaceholder(key)
      assertNoPlaceholder(item)
    })
}

function validateGroups(value: unknown, rendered: boolean, slots: TemplateSourceSlot[] = []) {
  const slotMap = new Map(slots.map((slot) => [slot.key, slot]))
  if (!Array.isArray(value) || !value.length) throw new Error('proxy-groups 必须是非空数组')
  const names = new Set<string>()
  const usedSlots = new Set<string>()
  for (const group of value) {
    if (!object(group)) throw new Error('proxy-group 必须是对象')
    if (typeof group.name !== 'string' || !group.name.trim()) throw new Error('proxy-group 缺少 name')
    if (typeof group.type !== 'string' || !group.type.trim()) throw new Error(`代理组“${group.name}”缺少 type`)
    if (names.has(group.name)) throw new Error(`代理组名称重复：${group.name}`)
    names.add(group.name)
    for (const slot of slots)
      if (
        group['include-all'] === true ||
        group[slot.type === 'subscription' ? 'include-all-providers' : 'include-all-proxies'] === true
      )
        usedSlots.add(slot.key)
    for (const [key, item] of Object.entries(group)) {
      assertNoPlaceholder(key)
      if (key !== 'proxies' && key !== 'use') assertNoPlaceholder(item)
    }
    for (const field of ['proxies', 'use']) {
      const members = group[field]
      if (members === undefined) continue
      if (!Array.isArray(members) || members.some((item) => typeof item !== 'string'))
        throw new Error(`代理组“${group.name}”的 ${field} 必须是字符串数组`)
      for (const item of members) {
        const slot = slotMap.get(item)
        if (slot) {
          if ((slot.type === 'subscription') !== (field === 'use'))
            throw new Error(`槽位“${slot.name}”必须通过 ${slot.type === 'subscription' ? 'use' : 'proxies'} 引用`)
          usedSlots.add(item)
        } else assertNoPlaceholder(item)
      }
    }
  }
  if (!rendered)
    for (const { key, name } of slots) if (!usedSlots.has(key)) throw new Error(`节点源槽位未被代理组引用：${name}`)
}

function validateShape(config: MihomoTemplateConfig, rendered: boolean, slots?: TemplateSourceSlot[]) {
  validateGroups(config['proxy-groups'], rendered, slots)
  for (const [key, value] of Object.entries(config)) {
    assertNoPlaceholder(key)
    if (key !== 'proxy-groups') assertNoPlaceholder(value)
  }
  if (
    config.rules !== undefined &&
    (!Array.isArray(config.rules) || config.rules.some((item) => typeof item !== 'string'))
  )
    throw new Error('rules 必须是字符串数组')
}

export function parseTemplateYaml(yaml: string, sourceSlots: TemplateSourceSlot[]) {
  if (!yaml.trim()) throw new Error('模板 YAML 不能为空')
  if (new TextEncoder().encode(yaml).byteLength > MAX_TEMPLATE_BYTES) throw new Error('模板 YAML 超过 1 MiB')
  let config: unknown
  try {
    config = parse(yaml, { maxAliasCount: 20 })
  } catch (error) {
    throw new Error(`YAML 解析失败：${error instanceof Error ? error.message : '格式错误'}`)
  }
  if (!object(config)) throw new Error('模板根节点必须是对象')
  if (Object.hasOwn(config, 'x-wangwang')) throw new Error('模板 YAML 不能包含 x-wangwang')
  if (Object.hasOwn(config, 'proxies')) throw new Error('模板不能直接定义根级 proxies')
  const slots = validateTemplateSourceSlots(sourceSlots)
  validateShape(config, false, slots)
  return config
}

export function validateRenderedConfig(config: MihomoTemplateConfig) {
  if (Object.hasOwn(config, 'x-wangwang')) throw new Error('生成配置不能包含 x-wangwang')
  const providers = config['proxy-providers']
  if (providers !== undefined && !object(providers)) throw new Error('proxy-providers 必须是对象')
  if (
    !Array.isArray(config.proxies) ||
    (!config.proxies.length && (!object(providers) || !Object.keys(providers).length))
  )
    throw new Error('配置没有可用节点')
  const names = new Set<string>()
  for (const proxy of config.proxies) {
    if (!object(proxy) || typeof proxy.name !== 'string' || !proxy.name.trim()) throw new Error('生成节点缺少 name')
    if (names.has(proxy.name)) throw new Error(`生成节点名称重复：${proxy.name}`)
    names.add(proxy.name)
  }
  validateShape(config, true)
  for (const group of config['proxy-groups'] as Array<Record<string, unknown>>) {
    if (group['include-all'] === true || group['include-all-providers'] === true) continue
    for (const name of (group.use || []) as string[])
      if (!object(providers) || !Object.hasOwn(providers, name))
        throw new Error(`代理组“${group.name}”引用不存在的 provider：${name}`)
  }
}
