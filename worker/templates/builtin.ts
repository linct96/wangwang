import { parse } from 'yaml'
import { z } from 'zod'
import files from './builtin-files'
import type { TemplateSourceSlot } from './source-slots'
import { MAX_TEMPLATE_BYTES, parseTemplateYaml } from './validator'

export type BuiltinTemplate = {
  id: `builtin:${string}`
  name: string
  description: string
  yaml: string
  sourceSlots: TemplateSourceSlot[]
}

const metadataSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(200).default(''),
    order: z.number().int().nonnegative().default(0),
  })
  .strict()

export function loadBuiltinTemplates(sources: Record<string, string>): BuiltinTemplate[] {
  const ids = new Set<string>()
  return Object.entries(sources)
    .map(([path, source]) => {
      try {
        const slug = path.match(/^\.\/presets\/([a-z0-9][a-z0-9_-]*)\.ya?ml$/)?.[1]
        if (!slug) throw new Error('文件名只能包含小写字母、数字、下划线和连字符')
        const id = `builtin:${slug}` as const
        if (ids.has(id)) throw new Error('模板 ID 重复')
        ids.add(id)
        if (new TextEncoder().encode(source).byteLength > MAX_TEMPLATE_BYTES) throw new Error('模板文件超过 1 MiB')
        const frontMatter = source.match(/^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/)
        if (!frontMatter) throw new Error('模板文件必须以 --- 分隔的 YAML 元数据开头')
        const metadata = metadataSchema.parse(parse(frontMatter[1], { maxAliasCount: 20 }))
        const yaml = frontMatter[2]
        parseTemplateYaml(yaml, [])
        return {
          id,
          name: metadata.name,
          description: metadata.description,
          yaml,
          sourceSlots: [],
          order: metadata.order,
        }
      } catch (error) {
        throw new Error(`内置模板 ${path} 无效：${error instanceof Error ? error.message : String(error)}`)
      }
    })
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map(({ order: _order, ...template }) => template)
}

export const builtinTemplates = loadBuiltinTemplates(files)

export function builtinTemplate(id: string) {
  return builtinTemplates.find((template) => template.id === id)
}
