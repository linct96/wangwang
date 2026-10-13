export const SOURCE_SLOT_KEY_PATTERN = /^__WANGWANG_SOURCE_SLOT_[A-Za-z0-9_-]{6}__$/

import type { TemplateSourceSlot } from '../../shared/source-slots'
export type { TemplateSourceSlot } from '../../shared/source-slots'
export { slotProviderName } from '../../shared/source-slots'

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function validateTemplateSourceSlots(value: unknown): TemplateSourceSlot[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error('模板最多包含 20 个节点源槽位')

  const slots: TemplateSourceSlot[] = value.map((source): TemplateSourceSlot => {
    if (!object(source) || typeof source.key !== 'string' || !SOURCE_SLOT_KEY_PATTERN.test(source.key))
      throw new Error('节点源槽位 key 格式无效')
    if (typeof source.name !== 'string' || !source.name.trim()) throw new Error('节点源槽位名称不能为空')
    if (source.name.trim().length > 40) throw new Error('节点源槽位名称不能超过 40 个字符')
    if (source.type !== 'nodes' && source.type !== 'subscription') throw new Error('槽位类型无效')
    return { key: source.key, name: source.name.trim(), type: source.type }
  })
  if (new Set(slots.map(({ key }) => key)).size !== slots.length) throw new Error('节点源槽位 key 不能重复')
  if (new Set(slots.map(({ name }) => name)).size !== slots.length) throw new Error('节点源槽位名称不能重复')
  return slots
}
