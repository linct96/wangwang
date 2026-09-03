import { Hono } from 'hono'
import { count, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { body, fail, ok } from '../http'
import { profiles } from '../db'
import type { TemplateId } from '../db'
import { createJob, db } from '../tasks'
import { subscriptionToken } from '../security'
import { resolveTemplate } from '../templates/resolver'
import { parseTemplateYaml } from '../templates/validator'
import { parseTemplateSourceSlots, type TemplateSourceSlot } from '../templates/source-slots'
import {
  profileBindingState,
  readProfileSourceBindings,
  replaceProfileSourceBindings,
  validateProfileSourceBindings,
  type ProfileSourceBindingInput,
} from '../profile-source-bindings'
import { normalizeTagInputs } from '../tag-model'
import { profileTagViews, replaceProfileTagFilters } from '../tag-store'

const templateIdSchema = z
  .string()
  .refine((value) => /^(builtin:(minimal|standard|full)|[A-Za-z0-9_-]{12})$/.test(value), {
    message: '订阅模板 ID 无效',
  })

const sourceBindingSchema = z.object({
  slotKey: z.string().trim().min(1),
  sourceIds: z.array(z.string().trim().min(1)).min(1),
})

export const profileSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    enabled: z.boolean().default(true),
    sourceBindings: z.array(sourceBindingSchema).min(1).max(20),
    tags: z.array(z.string().trim().min(1).max(24)).max(20).default([]),
    templateId: templateIdSchema.default('builtin:minimal'),
  })
  .strict()

export const profileUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    enabled: z.boolean(),
    sourceBindings: z.array(sourceBindingSchema).min(1).max(20),
    tags: z.array(z.string().trim().min(1).max(24)).max(20),
    templateId: templateIdSchema,
  })
  .partial()
  .strict()

export async function profileView(
  env: Env,
  profile: typeof profiles.$inferSelect,
  origin: string,
  includeYaml = false,
) {
  const template = await resolveTemplate(env, profile.templateId)
  let slots: TemplateSourceSlot[] = []
  if (template) {
    try {
      slots = parseTemplateSourceSlots(parseTemplateYaml(template.yaml))
    } catch {
      slots = []
    }
  }

  const [{ complete, bindings }, tagRows] = await Promise.all([
    profileBindingState(env, profile.id, slots),
    profileTagViews(env, profile.id),
  ])

  const token = await subscriptionToken(env.SUBSCRIPTION_TOKEN_SECRET, profile.id, profile.tokenVersion)
  return {
    ...profile,
    tags: tagRows.map((tag) => tag.name),
    compiledYaml: includeYaml ? profile.compiledYaml : undefined,
    sourceBindings: bindings,
    bindingComplete: complete,
    subscriptionUrl: `${origin}/s/${token}/config.yaml`,
  }
}

export const profilesRouter = new Hono<{ Bindings: Env }>()

profilesRouter.get('/', async (c) => {
  const rows = await db(c.env).select().from(profiles).orderBy(desc(profiles.createdAt))
  const result = await Promise.all(rows.map((profile) => profileView(c.env, profile, new URL(c.req.url).origin)))
  return ok(c, result)
})

profilesRouter.post('/', async (c) => {
  const input = await body(c, profileSchema)
  const database = db(c.env)
  const [{ value }] = await database.select({ value: count() }).from(profiles)
  if (Number(value) >= 20) return fail(c, 409, 'PROFILE_LIMIT', '配置数量已达到 20 个')

  const template = await resolveTemplate(c.env, input.templateId)
  if (!template) return fail(c, 404, 'TEMPLATE_NOT_FOUND', '订阅模板不存在')
  if ('migrationStatus' in template && template.migrationStatus === 'needs_repair') {
    return fail(c, 409, 'TEMPLATE_MIGRATION_REQUIRED', '模板需要先修复槽位才能使用')
  }

  let slots: TemplateSourceSlot[]
  try {
    slots = parseTemplateSourceSlots(parseTemplateYaml(template.yaml))
  } catch (error) {
    return fail(c, 422, 'TEMPLATE_INVALID', error instanceof Error ? error.message : '模板无效')
  }

  let validBindings: ProfileSourceBindingInput[]
  try {
    validBindings = await validateProfileSourceBindings(c.env, slots, input.sourceBindings)
  } catch (error) {
    return fail(
      c,
      400,
      'PROFILE_SOURCE_BINDINGS_INVALID',
      error instanceof Error ? error.message : '节点源槽位绑定无效',
    )
  }

  const filterNames = normalizeTagInputs(input.tags, 20)
  const now = new Date()
  const profile = {
    id: crypto.randomUUID(),
    name: input.name,
    enabled: input.enabled,
    templateId: input.templateId as TemplateId,
    createdAt: now,
    updatedAt: now,
  }

  await database.insert(profiles).values(profile)
  await Promise.all([
    replaceProfileSourceBindings(c.env, profile.id, validBindings),
    replaceProfileTagFilters(c.env, profile.id, filterNames),
  ])

  const job = await createJob(c.env, 'compile_profile', profile.id)
  const stored = await database.select().from(profiles).where(eq(profiles.id, profile.id)).get()
  return c.json(
    { data: { profile: await profileView(c.env, stored!, new URL(c.req.url).origin, true), jobId: job.id } },
    202,
  )
})

profilesRouter.get('/:id', async (c) => {
  const profile = await db(c.env)
    .select()
    .from(profiles)
    .where(eq(profiles.id, c.req.param('id')))
    .get()
  if (!profile) return fail(c, 404, 'PROFILE_NOT_FOUND', '配置不存在')
  return ok(c, await profileView(c.env, profile, new URL(c.req.url).origin, true))
})

profilesRouter.patch('/:id', async (c) => {
  const input = await body(c, profileUpdateSchema)
  const id = c.req.param('id')
  const database = db(c.env)
  const current = await database.select().from(profiles).where(eq(profiles.id, id)).get()
  if (!current) return fail(c, 404, 'PROFILE_NOT_FOUND', '配置不存在')

  const targetTemplateId = input.templateId ?? current.templateId
  const template = await resolveTemplate(c.env, targetTemplateId)
  if (!template) return fail(c, 404, 'TEMPLATE_NOT_FOUND', '订阅模板不存在')
  if ('migrationStatus' in template && template.migrationStatus === 'needs_repair') {
    return fail(c, 409, 'TEMPLATE_MIGRATION_REQUIRED', '模板需要先修复槽位才能使用')
  }

  let slots: TemplateSourceSlot[]
  try {
    slots = parseTemplateSourceSlots(parseTemplateYaml(template.yaml))
  } catch (error) {
    return fail(c, 422, 'TEMPLATE_INVALID', error instanceof Error ? error.message : '模板无效')
  }

  const existingBindings = await readProfileSourceBindings(c.env, id)
  let validBindings: ProfileSourceBindingInput[] | null = null

  if (input.sourceBindings !== undefined) {
    try {
      validBindings = await validateProfileSourceBindings(c.env, slots, input.sourceBindings, existingBindings)
    } catch (error) {
      return fail(
        c,
        400,
        'PROFILE_SOURCE_BINDINGS_INVALID',
        error instanceof Error ? error.message : '节点源槽位绑定无效',
      )
    }
  } else if (input.templateId !== undefined && input.templateId !== current.templateId) {
    try {
      validBindings = await validateProfileSourceBindings(c.env, slots, existingBindings, existingBindings)
    } catch (error) {
      return fail(
        c,
        400,
        'PROFILE_SOURCE_BINDINGS_INVALID',
        error instanceof Error ? error.message : '节点源槽位绑定无效',
      )
    }
  }

  const filterNames = input.tags === undefined ? undefined : normalizeTagInputs(input.tags, 20)
  await database
    .update(profiles)
    .set({
      name: input.name,
      enabled: input.enabled,
      templateId: input.templateId as TemplateId | undefined,
      updatedAt: new Date(),
    })
    .where(eq(profiles.id, id))

  const syncs: Promise<unknown>[] = []
  if (validBindings) {
    syncs.push(replaceProfileSourceBindings(c.env, id, validBindings))
  }
  if (filterNames !== undefined) {
    syncs.push(replaceProfileTagFilters(c.env, id, filterNames))
  }
  await Promise.all(syncs)

  const job = await createJob(c.env, 'compile_profile', id)
  const updated = await database.select().from(profiles).where(eq(profiles.id, id)).get()
  return c.json(
    { data: { profile: await profileView(c.env, updated!, new URL(c.req.url).origin, true), jobId: job.id } },
    202,
  )
})

profilesRouter.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const result = await db(c.env).delete(profiles).where(eq(profiles.id, id)).returning({ id: profiles.id })
  if (!result.length) return fail(c, 404, 'PROFILE_NOT_FOUND', '配置不存在')
  return ok(c, { id })
})

profilesRouter.post('/:id/compile', async (c) => {
  const current = await db(c.env)
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.id, c.req.param('id')))
    .get()
  if (!current) return fail(c, 404, 'PROFILE_NOT_FOUND', '配置不存在')
  const job = await createJob(c.env, 'compile_profile', current.id)
  return c.json({ data: { jobId: job.id } }, 202)
})

profilesRouter.post('/:id/rotate-token', async (c) => {
  const id = c.req.param('id')
  const current = await db(c.env).select().from(profiles).where(eq(profiles.id, id)).get()
  if (!current) return fail(c, 404, 'PROFILE_NOT_FOUND', '配置不存在')
  const tokenVersion = current.tokenVersion + 1
  await db(c.env).update(profiles).set({ tokenVersion, updatedAt: new Date() }).where(eq(profiles.id, id))
  const token = await subscriptionToken(c.env.SUBSCRIPTION_TOKEN_SECRET, id, tokenVersion)
  return ok(c, { subscriptionUrl: `${new URL(c.req.url).origin}/s/${token}/config.yaml` })
})
