import { nanoid } from 'nanoid'

export const SOURCE_SLOT_KEY_PATTERN = /^__WANGWANG_SOURCE_SLOT_[A-Za-z0-9_-]{6}__$/
export const MAX_SOURCE_SLOTS = 20

export type TemplateSourceSlot = {
  key: string
  name: string
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function parseTemplateSourceSlots(config: Record<string, unknown>): TemplateSourceSlot[] {
  const metadata = config['x-wangwang']
  if (!isObject(metadata)) {
    throw new Error('模板必须包含 1 到 20 个节点源槽位')
  }

  for (const key of Object.keys(metadata)) {
    if (key !== 'sources') {
      throw new Error(`x-wangwang 包含未知字段：${key}`)
    }
  }

  const rawSources = metadata.sources
  if (!Array.isArray(rawSources) || rawSources.length === 0) {
    throw new Error('模板必须包含 1 到 20 个节点源槽位')
  }

  if (rawSources.length > MAX_SOURCE_SLOTS) {
    throw new Error(`模板节点源槽位数量不能超过 ${MAX_SOURCE_SLOTS} 个`)
  }

  const slots: TemplateSourceSlot[] = []
  const seenKeys = new Set<string>()
  const seenNames = new Set<string>()

  for (const item of rawSources) {
    if (!isObject(item)) {
      throw new Error('节点源槽位必须是对象')
    }

    const { key, name } = item
    if (typeof key !== 'string' || !SOURCE_SLOT_KEY_PATTERN.test(key)) {
      throw new Error('节点源槽位 key 格式无效')
    }

    if (seenKeys.has(key)) {
      throw new Error(`节点源槽位 key 重复：${key}`)
    }
    seenKeys.add(key)

    if (typeof name !== 'string') {
      throw new Error('节点源槽位缺少名称')
    }

    const trimmedName = name.trim()
    if (!trimmedName) {
      throw new Error('节点源槽位名称不能为空')
    }

    if (trimmedName.length > 40) {
      throw new Error('节点源槽位名称不能超过 40 个字符')
    }

    if (seenNames.has(trimmedName)) {
      throw new Error(`节点源槽位名称重复：${trimmedName}`)
    }
    seenNames.add(trimmedName)

    slots.push({ key, name: trimmedName })
  }

  return slots
}

export function sourceSlotKeySet(config: Record<string, unknown>): Set<string> {
  const slots = parseTemplateSourceSlots(config)
  return new Set(slots.map((slot) => slot.key))
}

export function generateSourceSlotKey(existingKeys?: Iterable<string>): string {
  const set = existingKeys ? (existingKeys instanceof Set ? existingKeys : new Set(existingKeys)) : null
  while (true) {
    const key = `__WANGWANG_SOURCE_SLOT_${nanoid(6)}__`
    if (!set || !set.has(key)) {
      return key
    }
  }
}

import { parse } from 'yaml'

export function sameSourceSlotStructure(oldYaml: string, nextYaml: string): boolean {
  try {
    const oldConfig = parse(oldYaml, { maxAliasCount: 20 }) as Record<string, unknown>
    const nextConfig = parse(nextYaml, { maxAliasCount: 20 }) as Record<string, unknown>
    const oldKeys = sourceSlotKeySet(oldConfig)
    const nextKeys = sourceSlotKeySet(nextConfig)
    if (oldKeys.size !== nextKeys.size) return false
    for (const key of oldKeys) {
      if (!nextKeys.has(key)) return false
    }
    return true
  } catch {
    return false
  }
}
