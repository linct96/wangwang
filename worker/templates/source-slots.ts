export const SOURCE_SLOT_KEY_PATTERN = /^__WANGWANG_SOURCE_SLOT_[A-Za-z0-9_-]{6}__$/

export type TemplateSourceSlot = {
  key: string
  name: string
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function validateTemplateSourceSlots(value: unknown): TemplateSourceSlot[] {
  if (!Array.isArray(value) || !value.length || value.length > 20) throw new Error('模板必须包含 1 到 20 个节点源槽位')

  const slots = value.map((source) => {
    if (!object(source) || typeof source.key !== 'string' || !SOURCE_SLOT_KEY_PATTERN.test(source.key))
      throw new Error('节点源槽位 key 格式无效')
    if (typeof source.name !== 'string' || !source.name.trim()) throw new Error('节点源槽位名称不能为空')
    if (source.name.trim().length > 40) throw new Error('节点源槽位名称不能超过 40 个字符')
    return { key: source.key, name: source.name.trim() }
  })
  if (new Set(slots.map(({ key }) => key)).size !== slots.length) throw new Error('节点源槽位 key 不能重复')
  if (new Set(slots.map(({ name }) => name)).size !== slots.length) throw new Error('节点源槽位名称不能重复')
  return slots
}
