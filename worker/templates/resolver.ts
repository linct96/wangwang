import { asc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { templateSlots, templates } from '../db'
import { builtinTemplate } from './builtin'
import { extractLegacyTemplateSlots, type TemplateSourceSlot } from './source-slots'
import { parseTemplateYaml } from './validator'

export type ResolvedTemplate = {
  id: string
  name: string
  description: string | null
  yaml: string
  sourceSlots: TemplateSourceSlot[]
  createdAt?: Date
  updatedAt?: Date
}

async function customTemplateView(env: Env, template: typeof templates.$inferSelect): Promise<ResolvedTemplate> {
  const rows = await drizzle(env.DB)
    .select({ key: templateSlots.key, name: templateSlots.name })
    .from(templateSlots)
    .where(eq(templateSlots.templateId, template.id))
    .orderBy(asc(templateSlots.position))
  if (rows.length) return { ...template, sourceSlots: rows }

  // SQLite 无法安全解析 YAML，旧模板在首次读取时一次性完成数据迁移。
  const legacy = extractLegacyTemplateSlots(template.yaml)
  if (!legacy) return { ...template, sourceSlots: [] }
  parseTemplateYaml(legacy.yaml, legacy.sourceSlots)
  await env.DB.batch([
    ...legacy.sourceSlots.map(({ key, name }, position) =>
      env.DB.prepare('INSERT INTO template_slots (template_id, `key`, name, position) VALUES (?, ?, ?, ?)').bind(
        template.id,
        key,
        name,
        position,
      ),
    ),
    env.DB.prepare('UPDATE templates SET yaml = ? WHERE id = ?').bind(legacy.yaml, template.id),
  ])
  return { ...template, yaml: legacy.yaml, sourceSlots: legacy.sourceSlots }
}

export async function resolveCustomTemplates(env: Env, rows: (typeof templates.$inferSelect)[]) {
  return Promise.all(rows.map((template) => customTemplateView(env, template)))
}

export async function resolveTemplate(env: Env, id: string): Promise<ResolvedTemplate | undefined> {
  const builtin = builtinTemplate(id)
  if (builtin) return builtin
  const template = await drizzle(env.DB).select().from(templates).where(eq(templates.id, id)).get()
  return template ? customTemplateView(env, template) : undefined
}

export function templateView(template: ResolvedTemplate, profileCount: number, includeYaml = false) {
  const builtin = template.id.startsWith('builtin:')
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    kind: builtin ? ('builtin' as const) : ('custom' as const),
    readOnly: builtin,
    profileCount,
    sourceSlots: template.sourceSlots,
    createdAt: template.createdAt || null,
    updatedAt: template.updatedAt || null,
    yaml: includeYaml ? template.yaml : undefined,
  }
}
