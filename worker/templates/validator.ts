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
  else if (object(value)) Object.values(value).forEach(assertNoPlaceholder)
}

function validateGroups(value: unknown, rendered: boolean, slotKeys = new Set<string>()) {
  if (!Array.isArray(value) || !value.length) throw new Error('proxy-groups 必须是非空数组')
  const names = new Set<string>()
  const usedSlots = new Set<string>()
  for (const group of value) {
    if (!object(group)) throw new Error('proxy-group 必须是对象')
    if (typeof group.name !== 'string' || !group.name.trim()) throw new Error('proxy-group 缺少 name')
    if (typeof group.type !== 'string' || !group.type.trim()) throw new Error(`代理组“${group.name}”缺少 type`)
    if (names.has(group.name)) throw new Error(`代理组名称重复：${group.name}`)
    names.add(group.name)
    if (group['include-all-proxies'] === true) slotKeys.forEach((key) => usedSlots.add(key))
    for (const [key, item] of Object.entries(group)) if (key !== 'proxies') assertNoPlaceholder(item)
    if (group.proxies === undefined) continue
    if (!Array.isArray(group.proxies) || group.proxies.some((item) => typeof item !== 'string'))
      throw new Error(`代理组“${group.name}”的 proxies 必须是字符串数组`)
    for (const item of group.proxies) {
      if (slotKeys.has(item)) usedSlots.add(item)
      else if (item.includes('__WANGWANG_')) throw new Error(`占位符位置或名称无效：${item}`)
    }
  }
  if (!rendered)
    for (const key of slotKeys) if (!usedSlots.has(key)) throw new Error(`节点源槽位未被代理组引用：${key}`)
}

function validateShape(config: MihomoTemplateConfig, rendered: boolean, slotKeys?: Set<string>) {
  validateGroups(config['proxy-groups'], rendered, slotKeys)
  for (const [key, value] of Object.entries(config)) {
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
  validateShape(config, false, new Set(slots.map(({ key }) => key)))
  return config
}

export function validateRenderedConfig(config: MihomoTemplateConfig) {
  if (Object.hasOwn(config, 'x-wangwang')) throw new Error('生成配置不能包含 x-wangwang')
  if (!Array.isArray(config.proxies) || !config.proxies.length) throw new Error('配置没有可用节点')
  const names = new Set<string>()
  for (const proxy of config.proxies) {
    if (!object(proxy) || typeof proxy.name !== 'string' || !proxy.name.trim()) throw new Error('生成节点缺少 name')
    if (names.has(proxy.name)) throw new Error(`生成节点名称重复：${proxy.name}`)
    names.add(proxy.name)
  }
  validateShape(config, true)
}
