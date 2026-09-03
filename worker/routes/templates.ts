import { asc, count, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { profiles, templates } from '../db'
import type { ProxyConfig, TemplateId } from '../db'
import { body, fail, ok } from '../http'
import { db, enqueueProfilesForTemplate, selectProfileSlotNodes } from '../tasks'
import { builtinTemplates } from '../templates/builtin'
import { renderMihomoConfig, type SelectedSlotNode } from '../templates/renderer'
import { resolveTemplate, templateView } from '../templates/resolver'
import { MAX_TEMPLATE_BYTES, parseTemplateYaml } from '../templates/validator'
import { parseTemplateSourceSlots, sameSourceSlotStructure } from '../templates/source-slots'
import { profileBindingState } from '../profile-source-bindings'

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

async function profileCounts(env: Env) {
  const rows = await db(env)
    .select({ templateId: profiles.templateId, value: count() })
    .from(profiles)
    .groupBy(profiles.templateId)
  return new Map(rows.map((row) => [row.templateId, Number(row.value)]))
}

export const templatesRouter = new Hono<{ Bindings: Env }>()

templatesRouter.get('/', async (c) => {
  const [counts, custom] = await Promise.all([
    profileCounts(c.env),
    db(c.env).select().from(templates).orderBy(asc(templates.createdAt)),
  ])
  const builtinViews = builtinTemplates.map((template) => templateView(template, counts.get(template.id) || 0))
  const customViews = custom.map((template) => templateView(template, counts.get(template.id) || 0))
  return ok(c, [...builtinViews, ...customViews])
})

async function assertTemplateCapacity(env: Env) {
  const [{ value }] = await db(env).select({ value: count() }).from(templates)
  return Number(value) < 20
}

templatesRouter.post('/', async (c) => {
  if (!(await assertTemplateCapacity(c.env))) return fail(c, 409, 'TEMPLATE_LIMIT', '自定义模板数量已达到 20 个')
  const input = await body(c, createSchema)
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
    migrationStatus: 'ready' as const,
    migrationError: null,
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
  if ('migrationStatus' in template && template.migrationStatus === 'needs_repair') {
    return fail(c, 409, 'TEMPLATE_MIGRATION_REQUIRED', '模板需要先修复槽位才能预览')
  }

  let slots: ReturnType<typeof parseTemplateSourceSlots>
  try {
    slots = parseTemplateSourceSlots(parseTemplateYaml(template.yaml))
  } catch (error) {
    return fail(c, 422, 'TEMPLATE_INVALID', error instanceof Error ? error.message : '模板无效')
  }

  let nodes: SelectedSlotNode[]
  if (input.profileId) {
    const profile = await db(c.env).select().from(profiles).where(eq(profiles.id, input.profileId)).get()
    if (!profile) return fail(c, 404, 'PROFILE_NOT_FOUND', '配置不存在')
    const { complete } = await profileBindingState(c.env, profile.id, slots)
    if (!complete) {
      return fail(c, 400, 'PROFILE_SOURCE_BINDINGS_INVALID', '配置的节点源槽位未绑定完成或缺少启用的节点源')
    }
    nodes = await selectProfileSlotNodes(c.env, profile)
  } else {
    nodes = slots.flatMap((slot, index) => [
      {
        slotKey: slot.key,
        entryId: `preview-${slot.key}-1`,
        sourceId: `preview-src-${index}`,
        name: `${slot.name} 01`,
        config: {
          name: `${slot.name} 01`,
          type: 'ss',
          server: `node1.slot${index}.example.com`,
          port: 8388,
        },
      },
      {
        slotKey: slot.key,
        entryId: `preview-${slot.key}-2`,
        sourceId: `preview-src-${index}`,
        name: `${slot.name} 02`,
        config: {
          name: `${slot.name} 02`,
          type: 'ss',
          server: `node2.slot${index}.example.com`,
          port: 8388,
        },
      },
    ])
  }

  try {
    const yaml = renderMihomoConfig({ nodes, template })
    const distinctNodeCount = new Set(nodes.map((n) => n.entryId)).size
    return ok(c, { yaml, nodeCount: distinctNodeCount })
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
    migrationStatus: 'ready' as const,
    migrationError: null,
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

  const [{ value: profileCount }] = await db(c.env)
    .select({ value: count() })
    .from(profiles)
    .where(eq(profiles.templateId, id as TemplateId))

  if (input.yaml) {
    try {
      parseTemplateYaml(input.yaml)
    } catch (error) {
      return fail(c, 422, 'TEMPLATE_INVALID', error instanceof Error ? error.message : '模板无效')
    }

    if (Number(profileCount) > 0 && current.migrationStatus === 'ready') {
      if (!sameSourceSlotStructure(current.yaml, input.yaml)) {
        return fail(c, 409, 'TEMPLATE_SOURCE_SLOTS_LOCKED', '模板正在被配置使用，不能新增、删除或修改节点源槽位')
      }
    }
  }

  const repairResolved = Boolean(input.yaml && current.migrationStatus === 'needs_repair')

  await db(c.env)
    .update(templates)
    .set({
      ...input,
      description: input.description === undefined ? undefined : input.description,
      migrationStatus: repairResolved ? ('ready' as const) : undefined,
      migrationError: repairResolved ? null : undefined,
      updatedAt: new Date(),
    })
    .where(eq(templates.id, id))

  const [updated, jobs] = await Promise.all([
    db(c.env).select().from(templates).where(eq(templates.id, id)).get(),
    enqueueProfilesForTemplate(c.env, id),
  ])
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
