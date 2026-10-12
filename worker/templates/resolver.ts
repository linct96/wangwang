import { asc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { profileSlotBindings, profiles, templateSlots, templates } from '../db'
import type { TemplateId } from '../db'
import { builtinTemplate } from './builtin'
import type { TemplateSourceSlot } from './source-slots'

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
    .select({ key: templateSlots.key, name: templateSlots.name, type: templateSlots.type })
    .from(templateSlots)
    .where(eq(templateSlots.templateId, template.id))
    .orderBy(asc(templateSlots.position))
  return { ...template, sourceSlots: rows }
}

export async function templateBoundSlotKeys(env: Env, templateId: string) {
  const rows = await drizzle(env.DB)
    .selectDistinct({ slotKey: profileSlotBindings.slotKey })
    .from(profileSlotBindings)
    .innerJoin(profiles, eq(profiles.id, profileSlotBindings.profileId))
    .where(eq(profiles.templateId, templateId as TemplateId))
  return rows.map(({ slotKey }) => slotKey)
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
