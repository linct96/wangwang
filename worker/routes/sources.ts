import { Hono } from 'hono'
import { asc, count, eq } from 'drizzle-orm'
import { z } from 'zod'
import { body, fail, ok } from '../http'
import { profileNodeSources, profileSlotSources, sources } from '../db'
import {
  affectedProfileIdsForSource,
  cleanupOrphanPhysicalNodes,
  createJob,
  db,
  enqueueAffectedProfiles,
  enqueueProfileIds,
} from '../tasks'
import { assertRemoteUrl } from '../security'
import { normalizeTagInputs, normalizeTagName } from '../tag-model'
import { replaceSourceTags, sourceTagViews } from '../tag-store'
import { sourceRequiredByProfile } from '../profile-slot-bindings'

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
      const [globalProfiles, slotProfiles] = await Promise.all([
        database
          .select({ id: profileNodeSources.profileId })
          .from(profileNodeSources)
          .where(eq(profileNodeSources.sourceId, source.id)),
        database
          .select({ id: profileSlotSources.profileId })
          .from(profileSlotSources)
          .where(eq(profileSlotSources.sourceId, source.id)),
      ])
      const profileCount = new Set([...globalProfiles, ...slotProfiles].map(({ id }) => id)).size
      return sourceView(source, profileCount, tagsBySource.get(source.id)?.map((tag) => tag.name) ?? [])
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
  const disabling = input.enabled === false && current.enabled
  if (disabling && (await sourceRequiredByProfile(c.env, current.id, true)))
    return fail(c, 409, 'SOURCE_REQUIRED_BY_SLOT', '该节点源是某个槽位的唯一可用源，无法停用')
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
  if (nodeTagsChanged) await replaceSourceTags(c.env, current.id, nodeTags)
  if ((typeof input.enabled === 'boolean' && input.enabled !== current.enabled) || nodeTagsChanged)
    await enqueueAffectedProfiles(c.env, current.id)
  const updated = await db(c.env).select().from(sources).where(eq(sources.id, current.id)).get()
  return ok(c, { source: sourceView(updated!, 0, nodeTags), jobId: null })
})

sourcesRouter.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const current = await db(c.env).select().from(sources).where(eq(sources.id, id)).get()
  if (!current) return fail(c, 404, 'SOURCE_NOT_FOUND', '节点源不存在')
  if (current.kind !== 'url') return fail(c, 403, 'SYSTEM_SOURCE', '系统节点源不能删除')
  if (await sourceRequiredByProfile(c.env, id, false))
    return fail(c, 409, 'SOURCE_REQUIRED_BY_SLOT', '该节点源是某个槽位的唯一绑定，无法删除')
  const profileIds = await affectedProfileIdsForSource(c.env, id)
  await db(c.env).delete(sources).where(eq(sources.id, id))
  await cleanupOrphanPhysicalNodes(c.env)
  await enqueueProfileIds(c.env, profileIds)
  return ok(c, { id, detachedProfileCount: profileIds.length, removedNodeCount: current.nodeCount })
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
