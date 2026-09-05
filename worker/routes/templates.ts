import { asc, count, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { profiles, templates } from '../db'
import type { TemplateId } from '../db'
import { body, fail, ok } from '../http'
import { db, enqueueProfilesForTemplate, selectProfileNodes } from '../tasks'
import { builtinTemplates } from '../templates/builtin'
import { renderMihomoConfig, type SelectedSlotNode } from '../templates/renderer'
import { resolveCustomTemplates, resolveTemplate, templateView } from '../templates/resolver'
import { SOURCE_SLOT_KEY_PATTERN } from '../templates/source-slots'
import { MAX_TEMPLATE_BYTES, parseTemplateYaml } from '../templates/validator'

const yamlSchema = z
  .string()
  .min(1, '模板 YAML 不能为空')
  .refine((value) => new TextEncoder().encode(value).byteLength <= MAX_TEMPLATE_BYTES, '模板 YAML 超过 1 MiB')
const sourceSlotsSchema = z
  .array(
    z
      .object({
        key: z.string().regex(SOURCE_SLOT_KEY_PATTERN, '节点源槽位 key 格式无效'),
        name: z.string().trim().min(1, '节点源槽位名称不能为空').max(40),
      })
      .strict(),
  )
  .min(1)
  .max(20)
const createSchema = z.object({
  name: z.string().trim().min(1, '请输入模板名称').max(60),
  description: z.string().trim().max(200).nullable().optional(),
  yaml: yamlSchema,
  sourceSlots: sourceSlotsSchema,
})
const updateSchema = createSchema.partial().refine((value) => Object.keys(value).length > 0, '没有可保存的内容')
const previewSchema = z
  .object({
    templateId: z.string().optional(),
    yaml: yamlSchema.optional(),
    sourceSlots: sourceSlotsSchema.optional(),
    profileId: z.string().optional(),
  })
  .refine((value) => Boolean(value.templateId) !== Boolean(value.yaml), 'templateId 和 yaml 必须且只能提供一个')
  .refine((value) => !value.yaml || Boolean(value.sourceSlots), '预览 YAML 时必须提供节点源槽位')

async function replaceTemplateSlots(env: Env, templateId: string, sourceSlots: z.infer<typeof sourceSlotsSchema>) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM template_slots WHERE template_id = ?').bind(templateId),
    ...sourceSlots.map(({ key, name }, position) =>
      env.DB.prepare('INSERT INTO template_slots (template_id, `key`, name, position) VALUES (?, ?, ?, ?)').bind(
        templateId,
        key,
        name,
        position,
      ),
    ),
  ])
}

async function profileCounts(env: Env) {
  const rows = await db(env)
    .select({ templateId: profiles.templateId, value: count() })
    .from(profiles)
    .groupBy(profiles.templateId)
  return new Map(rows.map((row) => [row.templateId, Number(row.value)]))
}

async function assertTemplateCapacity(env: Env) {
  const [{ value }] = await db(env).select({ value: count() }).from(templates)
  return Number(value) < 20
}

export const templatesRouter = new Hono<{ Bindings: Env }>()

templatesRouter.get('/', async (c) => {
  const [rows, counts] = await Promise.all([
    db(c.env).select().from(templates).orderBy(asc(templates.updatedAt)),
    profileCounts(c.env),
  ])
  const custom = await resolveCustomTemplates(c.env, rows)
  return ok(c, [
    ...builtinTemplates.map((template) => templateView(template, counts.get(template.id) || 0)),
    ...custom.map((template) => templateView(template, counts.get(template.id as TemplateId) || 0)),
  ])
})

templatesRouter.post('/', async (c) => {
  const input = await body(c, createSchema)
  if (!(await assertTemplateCapacity(c.env))) return fail(c, 409, 'TEMPLATE_LIMIT', '自定义模板数量已达到 20 个')
  try {
    parseTemplateYaml(input.yaml, input.sourceSlots)
  } catch (error) {
    return fail(c, 422, 'TEMPLATE_INVALID', error instanceof Error ? error.message : '模板无效')
  }
  const now = new Date()
  const template = {
    id: nanoid(12),
    name: input.name,
    description: input.description || null,
    yaml: input.yaml,
    createdAt: now,
    updatedAt: now,
  }
  await db(c.env).insert(templates).values(template)
  await replaceTemplateSlots(c.env, template.id, input.sourceSlots)
  return c.json({ data: templateView({ ...template, sourceSlots: input.sourceSlots }, 0, true) }, 201)
})

templatesRouter.post('/validate', async (c) => {
  const input = await body(c, z.object({ yaml: yamlSchema, sourceSlots: sourceSlotsSchema }))
  try {
    parseTemplateYaml(input.yaml, input.sourceSlots)
    return ok(c, { valid: true })
  } catch (error) {
    return fail(c, 422, 'TEMPLATE_INVALID', error instanceof Error ? error.message : '模板无效')
  }
})

templatesRouter.post('/preview', async (c) => {
  const input = await body(c, previewSchema)
  const template = input.yaml
    ? { yaml: input.yaml, sourceSlots: input.sourceSlots! }
    : await resolveTemplate(c.env, input.templateId!)
  if (!template) return fail(c, 404, 'TEMPLATE_NOT_FOUND', '订阅模板不存在')
  const slots = template.sourceSlots
  try {
    parseTemplateYaml(template.yaml, slots)
  } catch (error) {
    return fail(c, 422, 'TEMPLATE_INVALID', error instanceof Error ? error.message : '模板无效')
  }
  let nodes: SelectedSlotNode[] = slots.map(({ key, name }, index) => ({
    slotKey: key,
    nodeId: `preview-${index}`,
    name: `${name}示例`,
    config: { type: 'ss', server: `slot${index + 1}.example.com`, port: 8388 },
  }))
  if (input.profileId) {
    const profile = await db(c.env).select().from(profiles).where(eq(profiles.id, input.profileId)).get()
    if (!profile) return fail(c, 404, 'PROFILE_NOT_FOUND', '配置不存在')
    nodes = await selectProfileNodes(c.env, profile, new Map(slots.map(({ key, name }) => [key, name])))
  }
  try {
    return ok(c, {
      yaml: renderMihomoConfig({ nodes, template }),
      nodeCount: new Set(nodes.map(({ nodeId }) => nodeId)).size,
    })
  } catch (error) {
    return fail(c, 422, 'TEMPLATE_INVALID', error instanceof Error ? error.message : '模板无效')
  }
})

templatesRouter.post('/:id/duplicate', async (c) => {
  if (!(await assertTemplateCapacity(c.env))) return fail(c, 409, 'TEMPLATE_LIMIT', '自定义模板数量已达到 20 个')
  const source = await resolveTemplate(c.env, c.req.param('id'))
  if (!source) return fail(c, 404, 'TEMPLATE_NOT_FOUND', '订阅模板不存在')
  const now = new Date()
  const template = {
    id: nanoid(12),
    name: `${source.name} 副本`,
    description: source.description || null,
    yaml: source.yaml,
    createdAt: now,
    updatedAt: now,
  }
  await db(c.env).insert(templates).values(template)
  await replaceTemplateSlots(c.env, template.id, source.sourceSlots)
  return c.json({ data: templateView({ ...template, sourceSlots: source.sourceSlots }, 0, true) }, 201)
})

templatesRouter.get('/:id', async (c) => {
  const template = await resolveTemplate(c.env, c.req.param('id'))
  if (!template) return fail(c, 404, 'TEMPLATE_NOT_FOUND', '订阅模板不存在')
  const [{ value }] = await db(c.env)
    .select({ value: count() })
    .from(profiles)
    .where(eq(profiles.templateId, template.id as TemplateId))
  return ok(c, templateView(template, Number(value), true))
})

templatesRouter.patch('/:id', async (c) => {
  const id = c.req.param('id')
  if (id.startsWith('builtin:')) return fail(c, 409, 'TEMPLATE_READONLY', '内置模板不能修改')
  const input = await body(c, updateSchema)
  const current = await resolveTemplate(c.env, id)
  if (!current) return fail(c, 404, 'TEMPLATE_NOT_FOUND', '订阅模板不存在')
  const [{ value: profileCount }] = await db(c.env)
    .select({ value: count() })
    .from(profiles)
    .where(eq(profiles.templateId, id as TemplateId))
  const nextYaml = input.yaml || current.yaml
  const nextSlots = input.sourceSlots || current.sourceSlots
  try {
    parseTemplateYaml(nextYaml, nextSlots)
    const nextKeys = new Set(nextSlots.map(({ key }) => key))
    if (
      Number(profileCount) &&
      (current.sourceSlots.length !== nextSlots.length || current.sourceSlots.some(({ key }) => !nextKeys.has(key)))
    )
      return fail(c, 409, 'TEMPLATE_SOURCE_SLOTS_LOCKED', '模板正在使用，不能删除或替换节点源槽位')
  } catch (error) {
    return fail(c, 422, 'TEMPLATE_INVALID', error instanceof Error ? error.message : '模板无效')
  }
  await db(c.env)
    .update(templates)
    .set({
      name: input.name,
      description: input.description,
      yaml: input.yaml,
      updatedAt: new Date(),
    })
    .where(eq(templates.id, id))
  if (input.sourceSlots) await replaceTemplateSlots(c.env, id, input.sourceSlots)
  const [updated, jobs] = await Promise.all([resolveTemplate(c.env, id), enqueueProfilesForTemplate(c.env, id)])
  return c.json(
    { data: { template: templateView(updated!, Number(profileCount), true), jobIds: jobs.map((job) => job.id) } },
    202,
  )
})

templatesRouter.delete('/:id', async (c) => {
  const id = c.req.param('id')
  if (id.startsWith('builtin:')) return fail(c, 409, 'TEMPLATE_READONLY', '内置模板不能删除')
  const [{ value }] = await db(c.env)
    .select({ value: count() })
    .from(profiles)
    .where(eq(profiles.templateId, id as TemplateId))
  if (Number(value)) return fail(c, 409, 'TEMPLATE_IN_USE', '模板正在被配置使用')
  const deleted = await db(c.env).delete(templates).where(eq(templates.id, id)).returning({ id: templates.id })
  if (!deleted.length) return fail(c, 404, 'TEMPLATE_NOT_FOUND', '订阅模板不存在')
  return ok(c, { id })
})
