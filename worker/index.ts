import { and, asc, count, desc, eq, like, or, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import { jobs, nodes, profileNodeExclusions, profiles, profileSources, sources } from './db'
import type { QueueMessage, RuleModule } from './db'
import { assertRemoteUrl, constantTimeEqual, hashPassword, newSessionToken, SESSION_TTL, sessionHash, subscriptionToken, validOrigin, verifyPassword } from './security'
import { createJob, db, enqueueDueSources, processQueueMessage } from './tasks'

const sourceCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    kind: z.enum(['url', 'manual']),
    url: z.string().trim().max(2048).optional(),
    content: z.string().max(1024 * 1024).optional(),
    refreshIntervalHours: z.union([z.literal(0), z.literal(1), z.literal(6), z.literal(12), z.literal(24)]).default(6),
  })
  .superRefine((value, context) => {
    if (value.kind === 'url' && !value.url) context.addIssue({ code: 'custom', message: 'URL 节点源必须填写地址', path: ['url'] })
    if (value.kind === 'manual' && !value.content?.trim()) context.addIssue({ code: 'custom', message: '手动节点源必须填写内容', path: ['content'] })
  })

const sourceUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  enabled: z.boolean().optional(),
  refreshIntervalHours: z.union([z.literal(0), z.literal(1), z.literal(6), z.literal(12), z.literal(24)]).optional(),
})
const nodeUpdateSchema = z.object({
  alias: z.string().trim().max(80).nullable().optional(),
  enabled: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(24)).max(10).optional(),
})
const nodeBatchSchema = z.object({ ids: z.array(z.string()).min(1).max(100), enabled: z.boolean() })
const ruleModuleSchema = z.enum(['ads', 'private', 'cn'])
const profileSchema = z.object({
  name: z.string().trim().min(1).max(60),
  enabled: z.boolean().default(true),
  sourceIds: z.array(z.string()).min(1).max(20),
  protocols: z.array(z.string().trim().min(1).max(20)).max(20).default([]),
  tags: z.array(z.string().trim().min(1).max(24)).max(20).default([]),
  excludedNodeIds: z.array(z.string()).max(1000).default([]),
  ruleModules: z.array(ruleModuleSchema).max(3).default(['ads', 'private', 'cn']),
  dnsMode: z.enum(['fake-ip', 'redir-host']).default('fake-ip'),
})
const profileUpdateSchema = profileSchema.partial()

type AppContext = Context<{ Bindings: Env }>

function ok<T>(c: AppContext, data: T, status = 200) {
  return c.json({ data }, status as 200)
}

function fail(c: AppContext, status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 500, code: string, message: string) {
  return c.json({ error: { code, message } }, status)
}

async function body<T>(c: AppContext, schema: z.ZodType<T>) {
  let value: unknown
  try {
    value = await c.req.json()
  } catch {
    throw new Error('请求体必须是 JSON')
  }
  const result = schema.safeParse(value)
  if (!result.success) throw new Error(result.error.issues[0]?.message || '请求参数无效')
  return result.data
}

function displayUrl(value: string | null) {
  if (!value) return null
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}${url.search ? '?***' : ''}`
  } catch {
    return null
  }
}

function sourceView(source: typeof sources.$inferSelect) {
  const { content: _content, url, ...safe } = source
  return { ...safe, url: displayUrl(url) }
}

async function assertSourceIds(env: Env, ids: string[]) {
  const unique = [...new Set(ids)]
  const rows = await Promise.all(unique.map((id) => db(env).select({ id: sources.id }).from(sources).where(eq(sources.id, id)).get()))
  if (rows.some((row) => !row)) throw new Error('包含不存在的节点源')
  return unique
}

async function saveProfileRelations(env: Env, profileId: string, sourceIds: string[], excludedNodeIds: string[]) {
  const statements: D1PreparedStatement[] = [
    env.DB.prepare('DELETE FROM profile_sources WHERE profile_id = ?').bind(profileId),
    env.DB.prepare('DELETE FROM profile_node_exclusions WHERE profile_id = ?').bind(profileId),
  ]
  sourceIds.forEach((sourceId) => statements.push(env.DB.prepare('INSERT INTO profile_sources (profile_id, source_id) VALUES (?, ?)').bind(profileId, sourceId)))
  ;[...new Set(excludedNodeIds)].forEach((nodeId) =>
    statements.push(env.DB.prepare('INSERT OR IGNORE INTO profile_node_exclusions (profile_id, node_id) VALUES (?, ?)').bind(profileId, nodeId)),
  )
  await env.DB.batch(statements)
}

async function profileView(env: Env, profile: typeof profiles.$inferSelect, origin: string, includeYaml = false) {
  const sourceRows = await db(env).select({ id: profileSources.sourceId }).from(profileSources).where(eq(profileSources.profileId, profile.id))
  const exclusionRows = await db(env)
    .select({ id: profileNodeExclusions.nodeId })
    .from(profileNodeExclusions)
    .where(eq(profileNodeExclusions.profileId, profile.id))
  const token = await subscriptionToken(env.SUBSCRIPTION_TOKEN_SECRET, profile.id, profile.tokenVersion)
  return {
    ...profile,
    compiledYaml: includeYaml ? profile.compiledYaml : undefined,
    sourceIds: sourceRows.map((item) => item.id),
    excludedNodeIds: exclusionRows.map((item) => item.id),
    subscriptionUrl: `${origin}/s/${profile.id}/${token}/config.yaml`,
  }
}

const app = new Hono<{ Bindings: Env }>()

async function hasAdmin(env: Env) { return Boolean(await env.DB.prepare('SELECT id FROM admin_account WHERE id = 1').first()) }
async function authenticated(c: AppContext) {
  const token = c.req.header('Cookie')?.match(/(?:^|;\s*)ww_session=([^;]+)/)?.[1]
  if (!token) return false
  const hash = await sessionHash(token)
  const row = await c.env.DB.prepare('SELECT token_hash FROM admin_sessions WHERE token_hash = ? AND expires_at > ?').bind(hash, Date.now()).first()
  return Boolean(row)
}

app.use('/admin/api/*', async (c, next) => {
  if (c.req.path === '/admin/api/auth/login' || c.req.path === '/admin/api/auth/init') return next()
  if (!(await authenticated(c))) return fail(c, 401, 'AUTH_REQUIRED', '请先登录')
  if (!validOrigin(c.req.raw)) return fail(c, 403, 'ORIGIN_DENIED', '请求来源无效')
  await next()
})

app.get('/init', async (c) => {
  if (await hasAdmin(c.env)) return c.redirect('/admin/login')
  return c.html('<!doctype html><meta charset="utf-8"><title>初始化 Wangwang</title><style>body{font:16px system-ui;max-width:420px;margin:12vh auto;padding:24px}label{display:block;margin:14px 0}input{display:block;width:100%;padding:10px;box-sizing:border-box}button{padding:10px 18px}</style><h1>初始化管理员</h1><form method="post" action="/api/init"><label>邮箱<input name="email" type="email" required></label><label>密码<input name="password" type="password" minlength="12" required></label><label>确认密码<input name="confirmPassword" type="password" minlength="12" required></label><button>完成初始化</button></form>')
})
app.post('/api/init', async (c) => {
  if (await hasAdmin(c.env)) return c.redirect('/admin/login')
  const form = await c.req.parseBody()
  const email = String(form.email || '').trim().toLowerCase(); const password = String(form.password || ''); const confirm = String(form.confirmPassword || '')
  if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 12 || password !== confirm) return c.text('邮箱无效、密码至少 12 位且两次必须一致', 400)
  const { hash, salt } = await hashPassword(password)
  try { await c.env.DB.prepare('INSERT INTO admin_account (id,email,password_hash,password_salt,created_at) VALUES (1,?,?,?,?)').bind(1, email, hash, salt, Date.now()).run() } catch { return c.redirect('/admin/login') }
  return c.redirect('/admin/login')
})

app.post('/admin/api/auth/login', async (c) => {
  const input = await body(c, z.object({ email: z.string().email(), password: z.string().min(1) }))
  const account = await c.env.DB.prepare('SELECT email,password_hash,password_salt FROM admin_account WHERE id = 1').first<{ email: string; password_hash: string; password_salt: string }>()
  if (!account || account.email !== input.email.trim().toLowerCase() || !(await verifyPassword(input.password, account.password_salt, account.password_hash))) return fail(c, 401, 'LOGIN_FAILED', '邮箱或密码错误')
  const token = newSessionToken(); await c.env.DB.prepare('INSERT INTO admin_sessions (token_hash,expires_at,created_at) VALUES (?,?,?)').bind(await sessionHash(token), Date.now() + SESSION_TTL, Date.now()).run()
  return c.json({ data: { ok: true } }, 200, { 'Set-Cookie': `ww_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}` })
})
app.post('/admin/api/auth/logout', async (c) => { const token = c.req.header('Cookie')?.match(/(?:^|;\s*)ww_session=([^;]+)/)?.[1]; if (token) await c.env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(await sessionHash(token)).run(); return c.json({ data: { ok: true } }, 200, { 'Set-Cookie': 'ww_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' }) })

app.get('/healthz', async (c) => {
  const result = await db(c.env).get<{ ok: number }>(sql`SELECT 1 AS ok`)
  return c.json({ ok: result?.ok === 1 })
})

app.get('/admin/api/dashboard', async (c) => {
  const database = db(c.env)
  const [[sourceCount], [nodeCount], [profileCount], recentJobs] = await Promise.all([
    database.select({ value: count() }).from(sources),
    database.select({ value: count() }).from(nodes),
    database.select({ value: count() }).from(profiles),
    database.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(8),
  ])
  return ok(c, { sources: sourceCount.value, nodes: nodeCount.value, profiles: profileCount.value, recentJobs })
})

app.get('/admin/api/sources', async (c) => {
  const result = await db(c.env).select().from(sources).orderBy(desc(sources.createdAt))
  return ok(c, result.map(sourceView))
})

app.post('/admin/api/sources', async (c) => {
  const input = await body(c, sourceCreateSchema)
  const database = db(c.env)
  const [{ value }] = await database.select({ value: count() }).from(sources)
  if (Number(value) >= 20) return fail(c, 409, 'SOURCE_LIMIT', '节点源数量已达到 20 个')
  if (input.url) assertRemoteUrl(input.url)
  const now = new Date()
  const source = {
    id: crypto.randomUUID(),
    name: input.name,
    kind: input.kind,
    url: input.kind === 'url' ? input.url! : null,
    content: input.kind === 'manual' ? input.content! : null,
    refreshIntervalHours: input.kind === 'url' ? input.refreshIntervalHours : 0,
    enabled: true,
    status: 'idle' as const,
    createdAt: now,
    updatedAt: now,
  }
  await database.insert(sources).values(source)
  const job = await createJob(c.env, 'refresh_source', source.id)
  return c.json({ data: { sourceId: source.id, jobId: job.id } }, 202)
})

app.patch('/admin/api/sources/:id', async (c) => {
  const input = await body(c, sourceUpdateSchema)
  const current = await db(c.env).select().from(sources).where(eq(sources.id, c.req.param('id'))).get()
  if (!current) return fail(c, 404, 'SOURCE_NOT_FOUND', '节点源不存在')
  const interval = input.refreshIntervalHours ?? current.refreshIntervalHours
  const nextRefreshAt = current.kind === 'url' && (input.enabled ?? current.enabled) && interval > 0 ? new Date(Date.now() + interval * 3_600_000) : null
  await db(c.env)
    .update(sources)
    .set({ ...input, nextRefreshAt, updatedAt: new Date() })
    .where(eq(sources.id, current.id))
  const updated = await db(c.env).select().from(sources).where(eq(sources.id, current.id)).get()
  return ok(c, sourceView(updated!))
})

app.delete('/admin/api/sources/:id', async (c) => {
  const id = c.req.param('id')
  const current = await db(c.env).select().from(sources).where(eq(sources.id, id)).get()
  if (!current) return fail(c, 404, 'SOURCE_NOT_FOUND', '节点源不存在')
  const affected = await db(c.env).select({ id: profileSources.profileId }).from(profileSources).where(eq(profileSources.sourceId, id))
  await db(c.env).delete(sources).where(eq(sources.id, id))
  await c.env.DB.prepare('DELETE FROM nodes WHERE NOT EXISTS (SELECT 1 FROM source_nodes WHERE source_nodes.node_id = nodes.id)').run()
  for (const profile of affected) await createJob(c.env, 'compile_profile', profile.id)
  return ok(c, { id })
})

app.post('/admin/api/sources/:id/refresh', async (c) => {
  const current = await db(c.env).select({ id: sources.id }).from(sources).where(eq(sources.id, c.req.param('id'))).get()
  if (!current) return fail(c, 404, 'SOURCE_NOT_FOUND', '节点源不存在')
  const job = await createJob(c.env, 'refresh_source', current.id)
  return c.json({ data: { jobId: job.id } }, 202)
})

app.get('/admin/api/nodes', async (c) => {
  const page = Math.max(1, Number(c.req.query('page')) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query('pageSize')) || 50))
  const query = c.req.query('q')?.trim()
  const protocol = c.req.query('protocol')?.trim()
  const tag = c.req.query('tag')?.trim()
  const sourceId = c.req.query('sourceId')?.trim()
  const enabled = c.req.query('enabled')
  const filters = and(
    query ? or(like(nodes.alias, `%${query}%`), like(nodes.server, `%${query}%`), sql`${nodes.config} LIKE ${`%${query}%`}`) : undefined,
    protocol ? eq(nodes.protocol, protocol) : undefined,
    tag ? sql`${nodes.tags} LIKE ${`%"${tag.replaceAll('"', '')}"%`}` : undefined,
    enabled === 'true' ? eq(nodes.enabled, true) : enabled === 'false' ? eq(nodes.enabled, false) : undefined,
    sourceId ? sql`EXISTS (SELECT 1 FROM source_nodes sn WHERE sn.node_id = ${nodes.id} AND sn.source_id = ${sourceId})` : undefined,
  )
  const database = db(c.env)
  const [rows, [{ total }]] = await Promise.all([
    database.select().from(nodes).where(filters).orderBy(asc(nodes.protocol), asc(nodes.server)).limit(pageSize).offset((page - 1) * pageSize),
    database.select({ total: count() }).from(nodes).where(filters),
  ])
  return ok(c, {
    items: rows.map(({ config, ...node }) => ({ ...node, name: node.alias || config.name })),
    page,
    pageSize,
    total,
  })
})

app.patch('/admin/api/nodes/batch', async (c) => {
  const input = await body(c, nodeBatchSchema)
  const placeholders = input.ids.map(() => '?').join(',')
  await c.env.DB.prepare(`UPDATE nodes SET enabled = ?, updated_at = ? WHERE id IN (${placeholders})`).bind(input.enabled ? 1 : 0, Date.now(), ...input.ids).run()
  return ok(c, { updated: input.ids.length })
})

app.patch('/admin/api/nodes/:id', async (c) => {
  const input = await body(c, nodeUpdateSchema)
  const id = c.req.param('id')
  const current = await db(c.env).select().from(nodes).where(eq(nodes.id, id)).get()
  if (!current) return fail(c, 404, 'NODE_NOT_FOUND', '节点不存在')
  const tags = input.tags ? [...new Set(input.tags)] : undefined
  await db(c.env)
    .update(nodes)
    .set({ ...input, alias: input.alias || null, tags, updatedAt: new Date() })
    .where(eq(nodes.id, id))
  const updated = await db(c.env).select().from(nodes).where(eq(nodes.id, id)).get()
  const { config, ...safe } = updated!
  return ok(c, { ...safe, name: safe.alias || config.name })
})

app.get('/admin/api/profiles', async (c) => {
  const rows = await db(c.env).select().from(profiles).orderBy(desc(profiles.createdAt))
  const result = await Promise.all(rows.map((profile) => profileView(c.env, profile, new URL(c.req.url).origin)))
  return ok(c, result)
})

app.post('/admin/api/profiles', async (c) => {
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
  return c.json({ data: { profile: await profileView(c.env, stored!, new URL(c.req.url).origin, true), jobId: job.id } }, 202)
})

app.get('/admin/api/profiles/:id', async (c) => {
  const profile = await db(c.env).select().from(profiles).where(eq(profiles.id, c.req.param('id'))).get()
  if (!profile) return fail(c, 404, 'PROFILE_NOT_FOUND', '配置不存在')
  return ok(c, await profileView(c.env, profile, new URL(c.req.url).origin, true))
})

app.patch('/admin/api/profiles/:id', async (c) => {
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
    const oldSources = await database.select({ id: profileSources.sourceId }).from(profileSources).where(eq(profileSources.profileId, id))
    const oldExclusions = await database
      .select({ id: profileNodeExclusions.nodeId })
      .from(profileNodeExclusions)
      .where(eq(profileNodeExclusions.profileId, id))
    await saveProfileRelations(c.env, id, sourceIds || oldSources.map((item) => item.id), input.excludedNodeIds || oldExclusions.map((item) => item.id))
  }
  const job = await createJob(c.env, 'compile_profile', id)
  const updated = await database.select().from(profiles).where(eq(profiles.id, id)).get()
  return c.json({ data: { profile: await profileView(c.env, updated!, new URL(c.req.url).origin, true), jobId: job.id } }, 202)
})

app.delete('/admin/api/profiles/:id', async (c) => {
  const id = c.req.param('id')
  const result = await db(c.env).delete(profiles).where(eq(profiles.id, id)).returning({ id: profiles.id })
  if (!result.length) return fail(c, 404, 'PROFILE_NOT_FOUND', '配置不存在')
  return ok(c, { id })
})

app.post('/admin/api/profiles/:id/compile', async (c) => {
  const current = await db(c.env).select({ id: profiles.id }).from(profiles).where(eq(profiles.id, c.req.param('id'))).get()
  if (!current) return fail(c, 404, 'PROFILE_NOT_FOUND', '配置不存在')
  const job = await createJob(c.env, 'compile_profile', current.id)
  return c.json({ data: { jobId: job.id } }, 202)
})

app.post('/admin/api/profiles/:id/rotate-token', async (c) => {
  const id = c.req.param('id')
  const current = await db(c.env).select().from(profiles).where(eq(profiles.id, id)).get()
  if (!current) return fail(c, 404, 'PROFILE_NOT_FOUND', '配置不存在')
  const tokenVersion = current.tokenVersion + 1
  await db(c.env).update(profiles).set({ tokenVersion, updatedAt: new Date() }).where(eq(profiles.id, id))
  const token = await subscriptionToken(c.env.SUBSCRIPTION_TOKEN_SECRET, id, tokenVersion)
  return ok(c, { subscriptionUrl: `${new URL(c.req.url).origin}/s/${id}/${token}/config.yaml` })
})

app.get('/admin/api/jobs/:id', async (c) => {
  const job = await db(c.env).select().from(jobs).where(eq(jobs.id, c.req.param('id'))).get()
  if (!job) return fail(c, 404, 'JOB_NOT_FOUND', '任务不存在')
  return ok(c, job)
})

app.get('/s/:profileId/:token/config.yaml', async (c) => {
  const profile = await db(c.env).select().from(profiles).where(and(eq(profiles.id, c.req.param('profileId')), eq(profiles.enabled, true))).get()
  if (!profile?.compiledYaml) return c.notFound()
  const expected = await subscriptionToken(c.env.SUBSCRIPTION_TOKEN_SECRET, profile.id, profile.tokenVersion)
  if (!constantTimeEqual(expected, c.req.param('token'))) return c.notFound()
  const key = `profile:${profile.id}:revision:${profile.revision}`
  let yaml = await c.env.KV.get(key)
  if (!yaml) {
    yaml = profile.compiledYaml
    c.executionCtx.waitUntil(c.env.KV.put(key, yaml))
  }
  return c.body(yaml, 200, {
    'Content-Type': 'text/yaml; charset=utf-8',
    'Content-Disposition': `inline; filename="${profile.id}.yaml"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
})

async function adminAsset(c: AppContext) {
  let response = await c.env.ASSETS.fetch(c.req.raw)
  if (response.status === 404 && c.req.method === 'GET' && c.req.header('Accept')?.includes('text/html')) {
    const url = new URL(c.req.url)
    url.pathname = '/admin/index.html'
    response = await c.env.ASSETS.fetch(new Request(url, c.req.raw))
  }
  return response
}

app.get('/', (c) => c.redirect('/admin'))
app.get('/admin', adminAsset)
app.get('/admin/*', adminAsset)

app.notFound((c) => (c.req.path.startsWith('/admin/api/') ? fail(c, 404, 'NOT_FOUND', '接口不存在') : c.text('Not found', 404)))
app.onError((error, c) => fail(c, 500, 'INTERNAL_ERROR', error.message || '服务异常'))

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<QueueMessage>, env: Env) {
    for (const message of batch.messages) await processQueueMessage(env, message.body)
  },
  async scheduled(_controller: ScheduledController, env: Env) {
    await enqueueDueSources(env)
  },
} satisfies ExportedHandler<Env, QueueMessage>
