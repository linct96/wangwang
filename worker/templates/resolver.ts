import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { templates } from '../db'
import { builtinTemplate, builtinTemplates } from './builtin'
import { parseTemplateSourceSlots, type TemplateSourceSlot } from './source-slots'
import { parseTemplateYaml } from './validator'

export async function resolveTemplate(env: Env, id: string) {
  const builtin = builtinTemplate(id)
  if (builtin) return builtin
  return drizzle(env.DB).select().from(templates).where(eq(templates.id, id)).get()
}

export function templateView(
  template: (typeof builtinTemplates)[number] | typeof templates.$inferSelect,
  profileCount: number,
  includeYaml = false,
) {
  const builtin = template.id.startsWith('builtin:')
  let sourceSlots: TemplateSourceSlot[] = []
  try {
    sourceSlots = parseTemplateSourceSlots(parseTemplateYaml(template.yaml))
  } catch {
    sourceSlots = []
  }

  return {
    id: template.id,
    name: template.name,
    description: template.description,
    kind: builtin ? ('builtin' as const) : ('custom' as const),
    readOnly: builtin,
    profileCount,
    sourceSlots,
    migrationStatus: builtin
      ? ('ready' as const)
      : 'migrationStatus' in template
        ? template.migrationStatus
        : ('ready' as const),
    migrationError: builtin ? null : 'migrationError' in template ? template.migrationError : null,
    createdAt: 'createdAt' in template ? template.createdAt : null,
    updatedAt: 'updatedAt' in template ? template.updatedAt : null,
    yaml: includeYaml ? template.yaml : undefined,
  }
}
