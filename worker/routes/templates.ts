import { count, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { profiles, templates } from '../db'
import type { ProxyConfig, TemplateId } from '../db'
import { body, fail, ok } from '../http'
import { db, enqueueProfilesForTemplate, selectProfileNodes } from '../tasks'
import { builtinTemplates } from '../templates/builtin'
import { renderMihomoConfig } from '../templates/renderer'
import { resolveTemplate, templateView } from '../templates/resolver'
import { MAX_TEMPLATE_BYTES, parseTemplateYaml } from '../templates/validator'

const yamlSchema = z
  .string()
  .min(1, '模板 YAML 不能为空')
  .refine((value) => new TextEncoder().encode(value).byteLength <= MAX_TEMPLATE_BYTES, '模板 YAML 超过 1 MiB')
const createSchema = z.object({
  name: z.string().trim().min(1, '请输入模板名称').max(60),
  description: z.string().trim().max(200).nullable().optional(),
  yaml: yamlSchema,
})
const updateSchema = createSchema.partial().refine((value) => Object.keys(value).length > 0, '没有可保存的内容')
const previewSchema = z
  .object({ templateId: z.string().optional(), yaml: yamlSchema.optional(), profileId: z.string().optional() })
  .refine((value) => Boolean(value.templateId) !== Boolean(value.yaml), 'templateId 和 yaml 必须且只能提供一个')

const previewNodes: Array<{ name: string; config: ProxyConfig }> = [
  {
    name: '香港示例',
    config: {
      name: '香港示例',
      type: 'ss',
      server: 'hk.example.com',
      port: 8388,
      cipher: 'aes-128-gcm',
      password: 'demo',
    },
  },
  {
    name: '日本示例',
    config: {
      name: '日本示例',
      type: 'ss',
      server: 'jp.example.com',
      port: 8388,
      cipher: 'aes-128-gcm',
      password: 'demo',
    },
  },
]

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
  const [custom, counts] = await Promise.all([
    db(c.env).select().from(templates).orderBy(desc(templates.updatedAt)),
    profileCounts(c.env),
  ])
  return ok(c, [
    ...builtinTemplates.map((template) => templateView(template, counts.get(template.id) || 0)),
    ...custom.map((template) => templateView(template, counts.get(template.id as TemplateId) || 0)),
  ])
})

templatesRouter.post('/', async (c) => {
  const input = await body(c, createSchema)
  if (!(await assertTemplateCapacity(c.env))) return fail(c, 409, 'TEMPLATE_LIMIT', '自定义模板数量已达到 20 个')
  try {
    parseTemplateYaml(input.yaml)
  } catch (error) {
    return fail(c, 422, 'TEMPLATE_INVALID', error instanceof Error ? error.message : '模板无效')
  }
  const now = new Date()
  const template = {
    id: nanoid(12),
    name: input.name,
    description: input.description || null,
    yaml: input.yaml,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  }
  await db(c.env).insert(templates).values(template)
  return c.json({ data: templateView(template, 0, true) }, 201)
})

templatesRouter.post('/validate', async (c) => {
  const input = await body(c, z.object({ yaml: yamlSchema }))
  try {
    parseTemplateYaml(input.yaml)
    return ok(c, { valid: true })
  } catch (error) {
    return fail(c, 422, 'TEMPLATE_INVALID', error instanceof Error ? error.message : '模板无效')
  }
})

templatesRouter.post('/preview', async (c) => {
  const input = await body(c, previewSchema)
  const template = input.yaml ? { yaml: input.yaml } : await resolveTemplate(c.env, input.templateId!)
  if (!template) return fail(c, 404, 'TEMPLATE_NOT_FOUND', '订阅模板不存在')
  let nodes = previewNodes
  if (input.profileId) {
    const profile = await db(c.env).select().from(profiles).where(eq(profiles.id, input.profileId)).get()
    if (!profile) return fail(c, 404, 'PROFILE_NOT_FOUND', '配置不存在')
    nodes = await selectProfileNodes(c.env, profile)
  }
  try {
    return ok(c, { yaml: renderMihomoConfig({ nodes, template }), nodeCount: nodes.length })
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
    revision: 1,
    createdAt: now,
    updatedAt: now,
  }
  await db(c.env).insert(templates).values(template)
  return c.json({ data: templateView(template, 0, true) }, 201)
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
  const current = await db(c.env).select().from(templates).where(eq(templates.id, id)).get()
  if (!current) return fail(c, 404, 'TEMPLATE_NOT_FOUND', '订阅模板不存在')
  if (input.yaml) {
    try {
      parseTemplateYaml(input.yaml)
    } catch (error) {
      return fail(c, 422, 'TEMPLATE_INVALID', error instanceof Error ? error.message : '模板无效')
    }
  }
  await db(c.env)
    .update(templates)
    .set({
      ...input,
      description: input.description === undefined ? undefined : input.description,
      revision: current.revision + 1,
      updatedAt: new Date(),
    })
    .where(eq(templates.id, id))
  const [updated, jobs] = await Promise.all([
    db(c.env).select().from(templates).where(eq(templates.id, id)).get(),
    enqueueProfilesForTemplate(c.env, id),
  ])
  return c.json(
    { data: { template: templateView(updated!, jobs.length, true), jobIds: jobs.map((job) => job.id) } },
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
