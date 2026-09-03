import { Hono } from 'hono'
import { asc, count, countDistinct, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { body, fail, ok } from '../http'
import { profileSourceBindings, sources } from '../db'
import { cleanupOrphanNodes, createJob, db, enqueueAffectedProfiles, enqueueProfileCompileIfReady } from '../tasks'
import { assertRemoteUrl } from '../security'
import { normalizeTagInputs, normalizeTagName } from '../tag-model'
import { replaceSourceTags, sourceTagViews } from '../tag-store'
import { canDeleteSource, canDisableSource, sourceSlotUsage } from '../profile-source-bindings'
import { withDbLock } from '../locks'

const nodeNameFilterSchema = z
  .string()
  .trim()
  .max(200)
  .refine((value) => !value || safeRegExp(value), '节点名称过滤正则无效')
const nodeTagsSchema = z.array(z.string().trim().min(1).max(24)).max(10)
const userAgentSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[\x20-\x7e]+$/, 'User-Agent 仅支持 ASCII 字符')

export const sourceCreateSchema = z.object({
  name: z.string().trim().max(60).optional().default(''),
  url: z.string().trim().min(1).max(2048),
  refreshIntervalHours: z.union([z.literal(0), z.literal(1), z.literal(6), z.literal(12), z.literal(24)]).default(6),
  nodeNameFilter: nodeNameFilterSchema.optional().default(''),
  nodeTags: nodeTagsSchema.optional().default([]),
  userAgent: userAgentSchema.optional().default('mihomo'),
})

export const sourceUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  url: z.string().trim().min(1).max(2048).optional(),
  enabled: z.boolean().optional(),
  refreshIntervalHours: z.union([z.literal(0), z.literal(1), z.literal(6), z.literal(12), z.literal(24)]).optional(),
  nodeNameFilter: nodeNameFilterSchema.optional(),
  nodeTags: nodeTagsSchema.optional(),
  userAgent: userAgentSchema.optional(),
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

export function sourceView(source: typeof sources.$inferSelect, profileCount = 0, nodeTags: string[] = []) {
  return { ...source, nodeTags, pendingUrl: Boolean(source.pendingUrl), profileCount }
}

export const sourcesRouter = new Hono<{ Bindings: Env }>()

sourcesRouter.get('/', async (c) => {
  const includeSystem = c.req.query('includeSystem') === '1'
  const database = db(c.env)
  const result = await database
    .select()
    .from(sources)
    .where(includeSystem ? undefined : eq(sources.kind, 'url'))
    .orderBy(asc(sources.createdAt))
  const tagsBySource = await sourceTagViews(
    c.env,
    result.map((source) => source.id),
  )
  const views = await Promise.all(
    result.map(async (source) => {
      const [{ value }] = await database
        .select({ value: countDistinct(profileSourceBindings.profileId) })
        .from(profileSourceBindings)
        .where(eq(profileSourceBindings.sourceId, source.id))
      return sourceView(source, Number(value), tagsBySource.get(source.id)?.map((tag) => tag.name) ?? [])
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
  const name = input.name || new URL(input.url).hostname
  const nodeNameFilter = normalizeNodeNameFilter(input.nodeNameFilter)
  const now = new Date()
  const source = {
    id: crypto.randomUUID(),
    name,
    kind: 'url' as const,
    url: input.url,
    nodeNameFilter,
    userAgent: input.userAgent,
    refreshIntervalHours: input.refreshIntervalHours,
    enabled: true,
    status: 'idle' as const,
    createdAt: now,
    updatedAt: now,
  }
  await database.insert(sources).values(source)
  await replaceSourceTags(c.env, source.id, input.nodeTags)
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

  if (input.enabled === false && current.enabled === true) {
    const usages = await sourceSlotUsage(c.env, current.id)
    const check = canDisableSource(usages)
    if (!check.allowed) {
      return fail(c, 409, 'SOURCE_REQUIRED_BY_SLOT', '该节点源是所在订阅模板槽位的唯一可用源，无法禁用')
    }
  }

  if (input.url) assertRemoteUrl(input.url)
  const nodeNameFilter =
    input.nodeNameFilter === undefined ? current.nodeNameFilter : normalizeNodeNameFilter(input.nodeNameFilter)
  const currentNodeTags = (await sourceTagViews(c.env, [current.id])).get(current.id)?.map((tag) => tag.name) || []
  const nodeTags = input.nodeTags === undefined ? currentNodeTags : normalizeTagInputs(input.nodeTags, 10)
  const currentNormalizedTags = new Set(currentNodeTags.map(normalizeTagName))
  const nodeTagsChanged =
    currentNormalizedTags.size !== nodeTags.length ||
    nodeTags.some((tag) => !currentNormalizedTags.has(normalizeTagName(tag)))
  const userAgent = input.userAgent ?? current.userAgent
  const userAgentChanged = userAgent !== current.userAgent
  const interval = input.refreshIntervalHours ?? current.refreshIntervalHours
  const nextRefreshAt =
    current.kind === 'url' && (input.enabled ?? current.enabled) && interval > 0
      ? new Date(Date.now() + interval * 3_600_000)
      : null

  if (input.enabled === false && current.enabled === true) {
    const success = await withDbLock(c.env, 'source-binding-integrity', async () => {
      const updateResult = await db(c.env).run(sql`
        UPDATE sources
        SET
          name = ${input.name ?? current.name},
          enabled = 0,
          refresh_interval_hours = ${interval},
          node_name_filter = ${nodeNameFilter ?? null},
          user_agent = ${userAgent ?? 'mihomo'},
          pending_url = ${input.url ?? current.pendingUrl ?? null},
          status = ${input.url ? 'idle' : current.status},
          error = ${input.url ? null : current.error},
          etag = ${userAgentChanged ? null : current.etag},
          last_modified = ${userAgentChanged ? null : current.lastModified},
          next_refresh_at = ${nextRefreshAt ? nextRefreshAt.getTime() : null},
          updated_at = ${Date.now()}
        WHERE id = ${current.id}
          AND NOT EXISTS (
            SELECT 1
            FROM profile_source_bindings psb1
            WHERE psb1.source_id = sources.id
              AND NOT EXISTS (
                SELECT 1
                FROM profile_source_bindings psb2
                JOIN sources other_s ON other_s.id = psb2.source_id
                WHERE psb2.profile_id = psb1.profile_id
                  AND psb2.slot_key = psb1.slot_key
                  AND psb2.source_id != sources.id
                  AND other_s.enabled = 1
              )
          )
      `)
      return updateResult.meta.changes > 0
    })
    if (!success) {
      return fail(c, 409, 'SOURCE_REQUIRED_BY_SLOT', '该节点源是所在订阅模板槽位的唯一可用源，无法禁用')
    }
  } else {
    await db(c.env)
      .update(sources)
      .set({
        name: input.name,
        enabled: input.enabled,
        refreshIntervalHours: input.refreshIntervalHours,
        nodeNameFilter,
        userAgent,
        pendingUrl: input.url,
        status: input.url ? 'idle' : undefined,
        error: input.url ? null : undefined,
        etag: userAgentChanged ? null : undefined,
        lastModified: userAgentChanged ? null : undefined,
        nextRefreshAt,
        updatedAt: new Date(),
      })
      .where(eq(sources.id, current.id))
  }

  if (nodeTagsChanged) await replaceSourceTags(c.env, current.id, nodeTags)
  const updated = await db(c.env).select().from(sources).where(eq(sources.id, current.id)).get()
  if ((typeof input.enabled === 'boolean' && input.enabled !== current.enabled) || nodeTagsChanged)
    await enqueueAffectedProfiles(c.env, current.id)
  return ok(c, { source: sourceView(updated!, 0, nodeTags), jobId: null })
})

sourcesRouter.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const current = await db(c.env).select().from(sources).where(eq(sources.id, id)).get()
  if (!current) return fail(c, 404, 'SOURCE_NOT_FOUND', '节点源不存在')
  if (current.kind !== 'url') return fail(c, 403, 'SYSTEM_SOURCE', '系统节点源不能删除')

  const usages = await sourceSlotUsage(c.env, id)
  const check = canDeleteSource(usages)
  if (!check.allowed) {
    return fail(c, 409, 'SOURCE_REQUIRED_BY_SLOT', '该节点源已被订阅模板槽位独占绑定，无法删除')
  }

  const affectedRows = await db(c.env)
    .select({ id: profileSourceBindings.profileId })
    .from(profileSourceBindings)
    .where(eq(profileSourceBindings.sourceId, id))
  const affectedProfileIds = [...new Set(affectedRows.map((r) => r.id))]

  const success = await withDbLock(c.env, 'source-binding-integrity', async () => {
    const deleteResult = await db(c.env).run(sql`
      DELETE FROM sources
      WHERE id = ${id}
        AND NOT EXISTS (
          SELECT 1
          FROM profile_source_bindings psb1
          WHERE psb1.source_id = sources.id
            AND NOT EXISTS (
              SELECT 1
              FROM profile_source_bindings psb2
              WHERE psb2.profile_id = psb1.profile_id
                AND psb2.slot_key = psb1.slot_key
                AND psb2.source_id != sources.id
            )
        )
    `)

    if (deleteResult.meta.changes === 0) {
      const exists = await db(c.env).select({ id: sources.id }).from(sources).where(eq(sources.id, id)).get()
      if (exists) {
        return false
      }
    }

    await cleanupOrphanNodes(c.env)
    return true
  })

  if (!success) {
    return fail(c, 409, 'SOURCE_REQUIRED_BY_SLOT', '该节点源已被订阅模板槽位独占绑定，无法删除')
  }

  for (const profileId of affectedProfileIds) await enqueueProfileCompileIfReady(c.env, profileId)
  return ok(c, { id, detachedProfileCount: affectedProfileIds.length, removedNodeCount: current.nodeCount })
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
