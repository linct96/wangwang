import { Hono } from 'hono'
import { count, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { body, fail, ok } from '../http'
import { profileNodeExclusions, profiles, profileSources, sources } from '../db'
import type { RuleModule } from '../db'
import { createJob, db } from '../tasks'
import { subscriptionToken } from '../security'

const ruleModuleSchema = z.enum(['ads', 'private', 'cn'])

export const profileSchema = z.object({
  name: z.string().trim().min(1).max(60),
  enabled: z.boolean().default(true),
  sourceIds: z.array(z.string()).min(1).max(20),
  protocols: z.array(z.string().trim().min(1).max(20)).max(20).default([]),
  tags: z.array(z.string().trim().min(1).max(24)).max(20).default([]),
  excludedNodeIds: z.array(z.string()).max(1000).default([]),
  ruleModules: z.array(ruleModuleSchema).max(3).default(['ads', 'private', 'cn']),
  dnsMode: z.enum(['fake-ip', 'redir-host']).default('fake-ip'),
})

export const profileUpdateSchema = profileSchema.partial()

export async function assertSourceIds(env: Env, ids: string[]) {
  const unique = [...new Set(ids)]
  const rows = await Promise.all(
    unique.map((id) => db(env).select({ id: sources.id }).from(sources).where(eq(sources.id, id)).get()),
  )
  if (rows.some((row) => !row)) throw new Error('包含不存在的节点源')
  return unique
}

export async function saveProfileRelations(
  env: Env,
  profileId: string,
  sourceIds: string[],
  excludedNodeIds: string[],
) {
  const statements: D1PreparedStatement[] = [
    env.DB.prepare('DELETE FROM profile_sources WHERE profile_id = ?').bind(profileId),
    env.DB.prepare('DELETE FROM profile_node_exclusions WHERE profile_id = ?').bind(profileId),
  ]
  sourceIds.forEach((sourceId) =>
    statements.push(
      env.DB.prepare('INSERT INTO profile_sources (profile_id, source_id) VALUES (?, ?)').bind(profileId, sourceId),
    ),
  )
  ;[...new Set(excludedNodeIds)].forEach((nodeId) =>
    statements.push(
      env.DB.prepare('INSERT OR IGNORE INTO profile_node_exclusions (profile_id, node_id) VALUES (?, ?)').bind(
        profileId,
        nodeId,
      ),
    ),
  )
  await env.DB.batch(statements)
}

export async function profileView(
  env: Env,
  profile: typeof profiles.$inferSelect,
  origin: string,
  includeYaml = false,
) {
  const sourceRows = await db(env)
    .select({ id: profileSources.sourceId })
    .from(profileSources)
    .where(eq(profileSources.profileId, profile.id))
  const exclusionRows = await db(env)
    .select({ id: profileNodeExclusions.nodeId })
    .from(profileNodeExclusions)
    .where(eq(profileNodeExclusions.profileId, profile.id))
  const token = subscriptionToken()
  return {
    ...profile,
    compiledYaml: includeYaml ? profile.compiledYaml : undefined,
    sourceIds: sourceRows.map((item) => item.id),
    excludedNodeIds: exclusionRows.map((item) => item.id),
    subscriptionUrl: `${origin}/s/${profile.id}/${token}/config.yaml`,
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
  const sourceIds = await assertSourceIds(c.env, input.sourceIds)
  const now = new Date()
  const profile = {
    id: crypto.randomUUID(),
    name: input.name,
    enabled: input.enabled,
    protocols: [...new Set(input.protocols)],
    tags: [...new Set(input.tags)],
    ruleModules: [...new Set(input.ruleModules)] as RuleModule[],
    dnsMode: input.dnsMode,
    createdAt: now,
    updatedAt: now,
  }
  await database.insert(profiles).values(profile)
  await saveProfileRelations(c.env, profile.id, sourceIds, input.excludedNodeIds)
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
  const sourceIds = input.sourceIds ? await assertSourceIds(c.env, input.sourceIds) : null
  const { sourceIds: _sourceIds, excludedNodeIds: _excluded, ...values } = input
  await database
    .update(profiles)
    .set({
      ...values,
      protocols: values.protocols ? [...new Set(values.protocols)] : undefined,
      tags: values.tags ? [...new Set(values.tags)] : undefined,
      ruleModules: values.ruleModules ? ([...new Set(values.ruleModules)] as RuleModule[]) : undefined,
      updatedAt: new Date(),
    })
    .where(eq(profiles.id, id))
  if (sourceIds || input.excludedNodeIds) {
    const oldSources = await database
      .select({ id: profileSources.sourceId })
      .from(profileSources)
      .where(eq(profileSources.profileId, id))
    const oldExclusions = await database
      .select({ id: profileNodeExclusions.nodeId })
      .from(profileNodeExclusions)
      .where(eq(profileNodeExclusions.profileId, id))
    await saveProfileRelations(
      c.env,
      id,
      sourceIds || oldSources.map((item) => item.id),
      input.excludedNodeIds || oldExclusions.map((item) => item.id),
    )
  }
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
  const token = subscriptionToken()
  return ok(c, { subscriptionUrl: `${new URL(c.req.url).origin}/s/${id}/${token}/config.yaml` })
})
