export type TagRecord = {
  id: string
  name: string
  normalizedName: string
}

export type TagView = Pick<TagRecord, 'id' | 'name'>

export function normalizeTagName(value: string) {
  return value.trim().replace(/[A-Z]/g, (char) => char.toLowerCase())
}

export function normalizeTagInputs(values: string[], max: number) {
  const result: string[] = []
  const seen = new Set<string>()
  for (const raw of values) {
    const name = raw.trim()
    if (!name) throw new Error('标签不能为空')
    if (name.length > 24) throw new Error('单个标签不能超过 24 个字符')
    const normalized = normalizeTagName(name)
    if (seen.has(normalized)) continue
    seen.add(normalized)
    result.push(name)
  }
  if (result.length > max) throw new Error(`标签不能超过 ${max} 个`)
  return result
}

export function mergeTagViews(direct: TagView[], inherited: TagView[]) {
  const result = new Map<string, TagView>()
  for (const tag of [...direct, ...inherited]) if (!result.has(tag.id)) result.set(tag.id, tag)
  return [...result.values()]
}

export function matchesAnyTag(nodeTagIds: string[], filterTagIds: string[]) {
  if (!filterTagIds.length) return true
  const nodeTags = new Set(nodeTagIds)
  return filterTagIds.some((id) => nodeTags.has(id))
}
