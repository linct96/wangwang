import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { templates } from '../db'
import { builtinTemplate, builtinTemplates } from './builtin'

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
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    revision: template.revision,
    kind: builtin ? ('builtin' as const) : ('custom' as const),
    readOnly: builtin,
    profileCount,
    createdAt: 'createdAt' in template ? template.createdAt : null,
    updatedAt: 'updatedAt' in template ? template.updatedAt : null,
    yaml: includeYaml ? template.yaml : undefined,
  }
}
