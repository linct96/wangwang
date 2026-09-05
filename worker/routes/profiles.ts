import { Hono } from 'hono'
import { count, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { body, fail, ok } from '../http'
import { profiles } from '../db'
import type { TemplateId } from '../db'
import { createJob, db, selectDraftProfileNodes } from '../tasks'
import { subscriptionToken } from '../security'
import { resolveTemplate } from '../templates/resolver'
import { renderMihomoConfig } from '../templates/renderer'
import {
  readProfileSlotBindings,
  replaceProfileSlotBindings,
  validateProfileNodeBinding,
  validateProfileSlotBindings,
} from '../profile-slot-bindings'
import { readProfileNodeBinding, replaceProfileNodeBinding } from '../profile-node-binding'
import { normalizeTagInputs } from '../tag-model'
import { profileTagViews, replaceProfileTagFilters } from '../tag-store'

const templateIdSchema = z
  .string()
  .refine((value) => /^(builtin:(minimal|standard|full)|[A-Za-z0-9_-]{12})$/.test(value), {
    message: '订阅模板 ID 无效',
  })
const regexSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim() || null : value),
  z.string().max(200).nullable(),
)
const nodeBindingSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('source'),
      sourceIds: z.array(z.string().min(1)).min(1).max(20),
      includeRegex: regexSchema,
      excludeRegex: regexSchema,
    })
    .strict(),
  z
    .object({
      mode: z.literal('node'),
      nodeIds: z.array(z.string().min(1)).min(1).max(1000),
    })
    .strict(),
  z
    .object({
      mode: z.literal('tag'),
      tags: z.array(z.string().trim().min(1).max(24)).min(1).max(20),
    })
    .strict(),
])
const slotBindingsSchema = z
  .array(
    z.discriminatedUnion('mode', [
      z
        .object({
          slotKey: z.string().min(1),
          mode: z.literal('source'),
          sourceIds: z.array(z.string().min(1)).min(1).max(20),
          includeRegex: regexSchema,
          excludeRegex: regexSchema,
        })
        .strict(),
      z
        .object({
          slotKey: z.string().min(1),
          mode: z.literal('node'),
          nodeIds: z.array(z.string().min(1)).min(1).max(1000),
        })
        .strict(),
      z
        .object({
          slotKey: z.string().min(1),
          mode: z.literal('tag'),
          tags: z.array(z.string().trim().min(1).max(24)).min(1).max(20),
        })
        .strict(),
    ]),
  )
  .max(20)

export const profileSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    enabled: z.boolean().default(true),
    nodeBinding: nodeBindingSchema,
    slotBindings: slotBindingsSchema,
    tags: z.array(z.string().trim().min(1).max(24)).max(20).default([]),
    templateId: templateIdSchema.default('builtin:minimal'),
  })
  .strict()

export const profileUpdateSchema = profileSchema.partial().strict()

async function templateSlots(env: Env, templateId: string) {
  const template = await resolveTemplate(env, templateId)
  return template?.sourceSlots || null
}

export async function profileView(
  env: Env,
  profile: typeof profiles.$inferSelect,
  origin: string,
  includeYaml = false,
) {
  const slots = (await templateSlots(env, profile.templateId)) || []
  const [nodeBinding, bindings, tags] = await Promise.all([
    readProfileNodeBinding(env, profile.id),
    readProfileSlotBindings(env, profile.id),
    profileTagViews(env, profile.id),
  ])
  const bySlot = new Map(bindings.map((binding) => [binding.slotKey, binding]))
  const token = await subscriptionToken(env.SUBSCRIPTION_TOKEN_SECRET, profile.id, profile.tokenVersion)
  return {
    ...profile,
    tags: tags.map(({ name }) => name),
    compiledYaml: includeYaml ? profile.compiledYaml : undefined,
    nodeBinding,
    slotBindings: slots.flatMap(({ key }) => {
      const binding = bySlot.get(key)
      return binding ? [binding] : []
    }),
    subscriptionUrl: `${origin}/s/${token}/config.yaml`,
  }
}

export const profilesRouter = new Hono<{ Bindings: Env }>()

profilesRouter.get('/', async (c) => {
  const rows = await db(c.env).select().from(profiles).orderBy(desc(profiles.createdAt))
  return ok(c, await Promise.all(rows.map((profile) => profileView(c.env, profile, new URL(c.req.url).origin))))
})

profilesRouter.post('/', async (c) => {
  const input = await body(c, profileSchema)
  const database = db(c.env)
  const [{ value }] = await database.select({ value: count() }).from(profiles)
  if (Number(value) >= 20) return fail(c, 409, 'PROFILE_LIMIT', '配置数量已达到 20 个')
  const slots = await templateSlots(c.env, input.templateId)
  if (!slots) return fail(c, 404, 'TEMPLATE_NOT_FOUND', '订阅模板不存在')

  let nodeBinding
  let bindings
  try {
    ;[nodeBinding, bindings] = await Promise.all([
      validateProfileNodeBinding(c.env, input.nodeBinding),
      validateProfileSlotBindings(c.env, slots, input.slotBindings),
    ])
  } catch (error) {
    return fail(c, 400, 'PROFILE_BINDINGS_INVALID', error instanceof Error ? error.message : '节点绑定无效')
  }

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
    replaceProfileNodeBinding(c.env, profile.id, nodeBinding),
    replaceProfileSlotBindings(c.env, profile.id, bindings),
    replaceProfileTagFilters(c.env, profile.id, normalizeTagInputs(input.tags, 20)),
  ])
  const job = await createJob(c.env, 'compile_profile', profile.id)
  const stored = await database.select().from(profiles).where(eq(profiles.id, profile.id)).get()
  return c.json(
    { data: { profile: await profileView(c.env, stored!, new URL(c.req.url).origin, true), jobId: job.id } },
    202,
  )
})

const previewProfileSchema = z.object({
  templateId: templateIdSchema,
  nodeBinding: nodeBindingSchema,
  slotBindings: slotBindingsSchema.default([]),
  tags: z.array(z.string().trim().min(1).max(24)).max(20).default([]),
})

profilesRouter.post('/preview', async (c) => {
  const input = await body(c, previewProfileSchema)
  const template = await resolveTemplate(c.env, input.templateId)
  if (!template) return fail(c, 404, 'TEMPLATE_NOT_FOUND', '订阅模板不存在')

  const slotNames = new Map(template.sourceSlots.map(({ key, name }) => [key, name]))
  try {
    const { globalNodes, slotNodes } = await selectDraftProfileNodes(c.env, input, slotNames)
    const uniquePhysicalCount = new Set([...globalNodes, ...slotNodes].map((n) => n.physicalNodeId)).size
    if (!uniquePhysicalCount) {
      return ok(c, { yaml: '', error: '当前配置没有可用节点', nodeCount: 0 })
    }
    const yaml = renderMihomoConfig({ globalNodes, slotNodes, template })
    return ok(c, { yaml, error: null, nodeCount: uniquePhysicalCount })
  } catch (error) {
    return ok(c, { yaml: '', error: error instanceof Error ? error.message : '生成配置预览失败', nodeCount: 0 })
  }
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
  if (input.templateId && input.templateId !== current.templateId && !input.slotBindings)
    return fail(c, 400, 'PROFILE_SLOT_BINDINGS_INVALID', '切换模板时必须重新绑定动态节点槽')

  let nodeBinding
  if (input.nodeBinding) {
    try {
      nodeBinding = await validateProfileNodeBinding(c.env, input.nodeBinding)
    } catch (error) {
      return fail(c, 400, 'PROFILE_NODE_BINDING_INVALID', error instanceof Error ? error.message : '节点选择无效')
    }
  }

  let bindings
  if (input.slotBindings) {
    const slots = await templateSlots(c.env, input.templateId || current.templateId)
    if (!slots) return fail(c, 404, 'TEMPLATE_NOT_FOUND', '订阅模板不存在')
    try {
      bindings = await validateProfileSlotBindings(c.env, slots, input.slotBindings)
    } catch (error) {
      return fail(c, 400, 'PROFILE_SLOT_BINDINGS_INVALID', error instanceof Error ? error.message : '槽位绑定无效')
    }
  }

  await database
    .update(profiles)
    .set({
      name: input.name,
      enabled: input.enabled,
      templateId: input.templateId as TemplateId | undefined,
      updatedAt: new Date(),
    })
    .where(eq(profiles.id, id))
  await Promise.all([
    nodeBinding ? replaceProfileNodeBinding(c.env, id, nodeBinding) : Promise.resolve(),
    bindings ? replaceProfileSlotBindings(c.env, id, bindings) : Promise.resolve(),
    input.tags === undefined
      ? Promise.resolve()
      : replaceProfileTagFilters(c.env, id, normalizeTagInputs(input.tags, 20)),
  ])
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
