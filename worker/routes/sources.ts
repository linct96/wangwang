import { Hono } from 'hono'
import { count, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { body, fail, ok } from '../http'
import { profileSources, sources } from '../db'
import { createJob, db, enqueueAffectedProfiles } from '../tasks'
import { assertRemoteUrl } from '../security'

const nodeNameFilterSchema = z
  .string()
  .trim()
  .max(200)
  .refine((value) => !value || safeRegExp(value), '节点名称过滤正则无效')

export const sourceCreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  url: z.string().trim().min(1).max(2048),
  refreshIntervalHours: z.union([z.literal(0), z.literal(1), z.literal(6), z.literal(12), z.literal(24)]).default(6),
  nodeNameFilter: nodeNameFilterSchema.optional().default(''),
})

export const sourceUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  url: z.string().trim().min(1).max(2048).optional(),
  enabled: z.boolean().optional(),
  refreshIntervalHours: z.union([z.literal(0), z.literal(1), z.literal(6), z.literal(12), z.literal(24)]).optional(),
  nodeNameFilter: nodeNameFilterSchema.optional(),
})

function safeRegExp(value: string) {
  try {
    new RegExp(value)
    return true
  } catch {
    return false
  }
}

function normalizeNodeNameFilter(value: string | undefined) {
  const normalized = value?.trim() || ''
  return normalized || null
}

export function displayUrl(value: string | null) {
  if (!value) return null
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}${url.search ? '?***' : ''}`
  } catch {
    return null
  }
}

export function sourceView(source: typeof sources.$inferSelect, profileCount = 0) {
  const { content: _content, url, ...safe } = source
  return { ...safe, pendingUrl: Boolean(source.pendingUrl), url: displayUrl(url), profileCount }
}

export const sourcesRouter = new Hono<{ Bindings: Env }>()

sourcesRouter.get('/', async (c) => {
  const includeSystem = c.req.query('includeSystem') === '1'
  const database = db(c.env)
  const result = await database
    .select()
    .from(sources)
    .where(includeSystem ? undefined : eq(sources.kind, 'url'))
    .orderBy(desc(sources.createdAt))
  const views = await Promise.all(
    result.map(async (source) => {
      const [{ value }] = await database
        .select({ value: count() })
        .from(profileSources)
        .where(eq(profileSources.sourceId, source.id))
      return sourceView(source, Number(value))
    }),
  )
  return ok(c, views)
})

sourcesRouter.post('/', async (c) => {
  const input = await body(c, sourceCreateSchema)
  const database = db(c.env)
  const [{ value }] = await database.select({ value: count() }).from(sources).where(eq(sources.kind, 'url'))
  if (Number(value) >= 20) return fail(c, 409, 'SOURCE_LIMIT', '节点源数量已达到 20 个')
  assertRemoteUrl(input.url)
  const nodeNameFilter = normalizeNodeNameFilter(input.nodeNameFilter)
  const now = new Date()
  const source = {
    id: crypto.randomUUID(),
    name: input.name,
    kind: 'url' as const,
    url: input.url,
    nodeNameFilter,
    content: null,
    refreshIntervalHours: input.refreshIntervalHours,
    enabled: true,
    status: 'idle' as const,
    createdAt: now,
    updatedAt: now,
  }
  await database.insert(sources).values(source)
  const job = await createJob(c.env, 'refresh_source', source.id)
  return c.json({ data: { sourceId: source.id, jobId: job.id } }, 202)
})

sourcesRouter.patch('/:id', async (c) => {
  const input = await body(c, sourceUpdateSchema)
  const current = await db(c.env)
    .select()
    .from(sources)
    .where(eq(sources.id, c.req.param('id')))
    .get()
  if (!current) return fail(c, 404, 'SOURCE_NOT_FOUND', '节点源不存在')
  if (current.kind !== 'url') return fail(c, 403, 'SYSTEM_SOURCE', '系统节点源不能修改')
  if (input.url) assertRemoteUrl(input.url)
  const nodeNameFilter =
    input.nodeNameFilter === undefined ? current.nodeNameFilter : normalizeNodeNameFilter(input.nodeNameFilter)
  const filterChanged = nodeNameFilter !== current.nodeNameFilter
  const interval = input.refreshIntervalHours ?? current.refreshIntervalHours
  const nextRefreshAt =
    current.kind === 'url' && (input.enabled ?? current.enabled) && interval > 0
      ? new Date(Date.now() + interval * 3_600_000)
      : null
  await db(c.env)
    .update(sources)
    .set({
      name: input.name,
      enabled: input.enabled,
      refreshIntervalHours: input.refreshIntervalHours,
      nodeNameFilter,
      pendingUrl: input.url,
      status: input.url ? 'idle' : undefined,
      error: input.url ? null : undefined,
      nextRefreshAt,
      updatedAt: new Date(),
    })
    .where(eq(sources.id, current.id))
  const updated = await db(c.env).select().from(sources).where(eq(sources.id, current.id)).get()
  if (typeof input.enabled === 'boolean' && input.enabled !== current.enabled)
    await enqueueAffectedProfiles(c.env, current.id)
  if (input.url || filterChanged) {
    try {
      const job = await createJob(c.env, 'refresh_source', current.id)
      return c.json({ data: { source: sourceView(updated!), jobId: job.id } }, 202)
    } catch (error) {
      await db(c.env).update(sources).set({ pendingUrl: null }).where(eq(sources.id, current.id))
      throw error
    }
  }
  return ok(c, { source: sourceView(updated!), jobId: null })
})

sourcesRouter.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const current = await db(c.env).select().from(sources).where(eq(sources.id, id)).get()
  if (!current) return fail(c, 404, 'SOURCE_NOT_FOUND', '节点源不存在')
  if (current.kind !== 'url') return fail(c, 403, 'SYSTEM_SOURCE', '系统节点源不能删除')
  const affected = await db(c.env)
    .select({ id: profileSources.profileId })
    .from(profileSources)
    .where(eq(profileSources.sourceId, id))
  await db(c.env).delete(sources).where(eq(sources.id, id))
  await c.env.DB.prepare(
    'DELETE FROM nodes WHERE NOT EXISTS (SELECT 1 FROM source_nodes WHERE source_nodes.node_id = nodes.id)',
  ).run()
  for (const profile of affected) await createJob(c.env, 'compile_profile', profile.id)
  return ok(c, { id, detachedProfileCount: affected.length, removedNodeCount: current.nodeCount })
})

sourcesRouter.post('/:id/refresh', async (c) => {
  const current = await db(c.env)
    .select({ id: sources.id, kind: sources.kind, enabled: sources.enabled })
    .from(sources)
    .where(eq(sources.id, c.req.param('id')))
    .get()
  if (!current) return fail(c, 404, 'SOURCE_NOT_FOUND', '节点源不存在')
  if (current.kind !== 'url') return fail(c, 403, 'SYSTEM_SOURCE', '系统节点源不能刷新')
  if (!current.enabled) return fail(c, 409, 'SOURCE_DISABLED', '请先启用节点源')
  const job = await createJob(c.env, 'refresh_source', current.id)
  return c.json({ data: { jobId: job.id } }, 202)
})
