import { and, asc, count, desc, eq, inArray, like, or, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import { jobs, nodes, profileNodeExclusions, profiles, profileSources, sourceNodes, sources } from './db'
import type { ProxyConfig, QueueMessage, RuleModule } from './db'
import { fingerprint } from './proxy'
import {
  assertRemoteUrl,
  constantTimeEqual,
  hashPassword,
  newSessionToken,
  SESSION_TTL,
  sessionHash,
  subscriptionToken,
  validOrigin,
  verifyPassword,
} from './security'
import {
  createJob,
  db,
  enqueueAffectedProfiles,
  enqueueProfilesForNode,
  enqueueProfilesForNodes,
  processQueueMessage,
} from './tasks'

const MANUAL_SOURCE_ID = 'system-manual'

const sourceCreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  url: z.string().trim().min(1).max(2048),
  refreshIntervalHours: z.union([z.literal(0), z.literal(1), z.literal(6), z.literal(12), z.literal(24)]).default(6),
})

const sourceUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  url: z.string().trim().min(1).max(2048).optional(),
  enabled: z.boolean().optional(),
  refreshIntervalHours: z.union([z.literal(0), z.literal(1), z.literal(6), z.literal(12), z.literal(24)]).optional(),
})

const connectionCommon = {
  name: z.string().trim().min(1).max(80),
  server: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
}
const transportFields = {
  network: z.enum(['tcp', 'ws', 'grpc']).default('tcp'),
  wsPath: z.string().max(2048).default('/'),
  wsHost: z.string().trim().max(255).optional(),
  grpcServiceName: z.string().max(255).optional(),
}
const tlsFields = {
  security: z.enum(['none', 'tls', 'reality']).default('none'),
  sni: z.string().trim().max(255).optional(),
  clientFingerprint: z.string().trim().max(60).optional(),
  realityPublicKey: z.string().trim().max(255).optional(),
  realityShortId: z.string().trim().max(255).optional(),
}
const manualConnectionSchema = z.discriminatedUnion('protocol', [
  z.object({
    ...connectionCommon,
    protocol: z.literal('ss'),
    cipher: z.string().trim().min(1).max(80),
    password: z.string().max(1024).optional(),
    plugin: z.string().trim().max(80).optional(),
    pluginOptions: z.record(z.string(), z.string()).default({}),
  }),
  z.object({
    ...connectionCommon,
    ...transportFields,
    protocol: z.literal('vmess'),
    uuid: z.string().trim().max(255).optional(),
    alterId: z.number().int().min(0).max(65535).default(0),
    cipher: z.string().trim().min(1).max(80).default('auto'),
    security: z.enum(['none', 'tls']).default('none'),
    sni: z.string().trim().max(255).optional(),
    clientFingerprint: z.string().trim().max(60).optional(),
  }),
  z.object({
    ...connectionCommon,
    ...transportFields,
    ...tlsFields,
    protocol: z.literal('vless'),
    uuid: z.string().trim().max(255).optional(),
    flow: z.string().trim().max(120).optional(),
  }),
  z.object({
    ...connectionCommon,
    ...transportFields,
    ...tlsFields,
    protocol: z.literal('trojan'),
    password: z.string().max(1024).optional(),
  }),
  z.object({
    ...connectionCommon,
    protocol: z.literal('hysteria2'),
    password: z.string().max(1024).optional(),
    sni: z.string().trim().max(255).optional(),
    skipCertVerify: z.boolean().default(false),
    obfs: z.string().trim().max(80).optional(),
    obfsPassword: z.string().max(1024).optional(),
  }),
  z.object({
    ...connectionCommon,
    protocol: z.literal('tuic'),
    uuid: z.string().trim().max(255).optional(),
    password: z.string().max(1024).optional(),
    sni: z.string().trim().max(255).optional(),
    congestionController: z.string().trim().min(1).max(80).default('bbr'),
    udpRelayMode: z.string().trim().min(1).max(80).default('native'),
    skipCertVerify: z.boolean().default(false),
  }),
])

const nodeCreateSchema = z.object({
  connection: manualConnectionSchema,
  tags: z.array(z.string().trim().min(1).max(24)).max(10).default([]),
  enabled: z.boolean().default(true),
})
const nodeUpdateSchema = z.object({
  alias: z.string().trim().max(80).nullable().optional(),
  enabled: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(24)).max(10).optional(),
  connection: manualConnectionSchema.optional(),
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

function sourceView(source: typeof sources.$inferSelect, profileCount = 0) {
  const { content: _content, url, ...safe } = source
  return { ...safe, pendingUrl: Boolean(source.pendingUrl), url: displayUrl(url), profileCount }
}

type ManualConnection = z.infer<typeof manualConnectionSchema>

function requiredSecret(value: string | undefined, current: unknown, label: string) {
  const result = value || (typeof current === 'string' ? current : '')
  if (!result) throw new Error(`${label}不能为空`)
  return result
}

function applyTransport(input: ManualConnection, config: ProxyConfig) {
  if (!('network' in input) || input.network === 'tcp') return
  config.network = input.network
  if (input.network === 'ws')
    config['ws-opts'] = { path: input.wsPath || '/', headers: input.wsHost ? { Host: input.wsHost } : undefined }
  if (input.network === 'grpc') config['grpc-opts'] = { 'grpc-service-name': input.grpcServiceName || '' }
}

function applyTls(input: ManualConnection, config: ProxyConfig) {
  if (!('security' in input) || input.security === 'none') return
  config.tls = true
  config.servername = input.sni || input.server
  if (input.clientFingerprint) config['client-fingerprint'] = input.clientFingerprint
  if (input.security === 'reality') {
    if (!input.realityPublicKey) throw new Error('Reality 公钥不能为空')
    config['reality-opts'] = { 'public-key': input.realityPublicKey, 'short-id': input.realityShortId || '' }
  }
}

function buildManualConfig(input: ManualConnection, current?: ProxyConfig): ProxyConfig {
  const config: ProxyConfig = {
    name: input.name,
    type: input.protocol,
    server: input.server,
    port: input.port,
    udp: true,
  }
  if (input.protocol === 'ss') {
    config.cipher = input.cipher
    config.password = requiredSecret(input.password, current?.password, '密码')
    if (input.plugin) {
      config.plugin = input.plugin
      config['plugin-opts'] = input.pluginOptions
    }
  } else if (input.protocol === 'vmess') {
    config.uuid = requiredSecret(input.uuid, current?.uuid, 'UUID')
    config.alterId = input.alterId
    config.cipher = input.cipher
    applyTransport(input, config)
    applyTls(input, config)
  } else if (input.protocol === 'vless') {
    config.uuid = requiredSecret(input.uuid, current?.uuid, 'UUID')
    if (input.flow) config.flow = input.flow
    applyTransport(input, config)
    applyTls(input, config)
  } else if (input.protocol === 'trojan') {
    config.password = requiredSecret(input.password, current?.password, '密码')
    applyTransport(input, config)
    applyTls(input, config)
  } else if (input.protocol === 'hysteria2') {
    config.password = requiredSecret(input.password, current?.password, '密码')
    config.sni = input.sni || input.server
    config['skip-cert-verify'] = input.skipCertVerify
    if (input.obfs) config.obfs = input.obfs
    if (input.obfsPassword || current?.['obfs-password'])
      config['obfs-password'] = input.obfsPassword || current?.['obfs-password']
  } else {
    config.uuid = requiredSecret(input.uuid, current?.uuid, 'UUID')
    config.password = requiredSecret(input.password, current?.password, '密码')
    config.sni = input.sni || input.server
    config['congestion-controller'] = input.congestionController
    config['udp-relay-mode'] = input.udpRelayMode
    config['skip-cert-verify'] = input.skipCertVerify
  }
  return config
}

function connectionView(config: ProxyConfig) {
  const common = { name: config.name, protocol: config.type, server: config.server, port: config.port }
  const network = String(config.network || 'tcp') as 'tcp' | 'ws' | 'grpc'
  const ws = (config['ws-opts'] || {}) as { path?: string; headers?: { Host?: string } }
  const grpc = (config['grpc-opts'] || {}) as { 'grpc-service-name'?: string }
  const reality = (config['reality-opts'] || {}) as { 'public-key'?: string; 'short-id'?: string }
  const transport = {
    network,
    wsPath: ws.path || '/',
    wsHost: ws.headers?.Host || '',
    grpcServiceName: grpc['grpc-service-name'] || '',
  }
  const tls = {
    security: reality['public-key'] ? ('reality' as const) : config.tls ? ('tls' as const) : ('none' as const),
    sni: String(config.servername || config.sni || ''),
    clientFingerprint: String(config['client-fingerprint'] || ''),
    realityPublicKey: reality['public-key'] || '',
    realityShortId: reality['short-id'] || '',
  }
  if (config.type === 'ss')
    return {
      ...common,
      cipher: String(config.cipher || ''),
      password: '',
      hasPassword: Boolean(config.password),
      plugin: String(config.plugin || ''),
      pluginOptions: (config['plugin-opts'] || {}) as Record<string, string>,
    }
  if (config.type === 'vmess')
    return {
      ...common,
      ...transport,
      ...tls,
      uuid: '',
      hasUuid: Boolean(config.uuid),
      alterId: Number(config.alterId || 0),
      cipher: String(config.cipher || 'auto'),
    }
  if (config.type === 'vless')
    return { ...common, ...transport, ...tls, uuid: '', hasUuid: Boolean(config.uuid), flow: String(config.flow || '') }
  if (config.type === 'trojan')
    return { ...common, ...transport, ...tls, password: '', hasPassword: Boolean(config.password) }
  if (config.type === 'hysteria2')
    return {
      ...common,
      password: '',
      hasPassword: Boolean(config.password),
      sni: String(config.sni || ''),
      skipCertVerify: Boolean(config['skip-cert-verify']),
      obfs: String(config.obfs || ''),
      obfsPassword: '',
      hasObfsPassword: Boolean(config['obfs-password']),
    }
  return {
    ...common,
    uuid: '',
    hasUuid: Boolean(config.uuid),
    password: '',
    hasPassword: Boolean(config.password),
    sni: String(config.sni || ''),
    congestionController: String(config['congestion-controller'] || 'bbr'),
    udpRelayMode: String(config['udp-relay-mode'] || 'native'),
    skipCertVerify: Boolean(config['skip-cert-verify']),
  }
}

function management(kinds: Array<'url' | 'manual'>) {
  const manual = kinds.includes('manual')
  const subscription = kinds.includes('url')
  return manual && subscription ? 'mixed' : manual ? 'manual' : 'subscription'
}

async function nodeKinds(env: Env, nodeIds: string[]) {
  const result = new Map<string, Array<'url' | 'manual'>>()
  if (!nodeIds.length) return result
  const rows = await db(env)
    .select({ nodeId: sourceNodes.nodeId, kind: sources.kind })
    .from(sourceNodes)
    .innerJoin(sources, eq(sources.id, sourceNodes.sourceId))
    .where(inArray(sourceNodes.nodeId, nodeIds))
  for (const row of rows) result.set(row.nodeId, [...(result.get(row.nodeId) || []), row.kind])
  return result
}

async function assertSourceIds(env: Env, ids: string[]) {
  const unique = [...new Set(ids)]
  const rows = await Promise.all(
    unique.map((id) => db(env).select({ id: sources.id }).from(sources).where(eq(sources.id, id)).get()),
  )
  if (rows.some((row) => !row)) throw new Error('包含不存在的节点源')
  return unique
}

async function saveProfileRelations(env: Env, profileId: string, sourceIds: string[], excludedNodeIds: string[]) {
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

async function profileView(env: Env, profile: typeof profiles.$inferSelect, origin: string, includeYaml = false) {
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

const app = new Hono<{ Bindings: Env }>()

async function hasAdmin(env: Env) {
  return Boolean(await env.DB.prepare('SELECT id FROM admin_account WHERE id = 1').first())
}
async function authenticated(c: AppContext) {
  const token = c.req.header('Cookie')?.match(/(?:^|;\s*)ww_session=([^;]+)/)?.[1]
  if (!token) return false
  const hash = await sessionHash(token)
  const row = await c.env.DB.prepare('SELECT token_hash FROM admin_sessions WHERE token_hash = ? AND expires_at > ?')
    .bind(hash, Date.now())
    .first()
  return Boolean(row)
}

app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/auth/login' || c.req.path === '/api/auth/init') return next()
  if (!(await authenticated(c))) return fail(c, 401, 'AUTH_REQUIRED', '请先登录')
  if (!validOrigin(c.req.raw)) return fail(c, 403, 'ORIGIN_DENIED', '请求来源无效')
  await next()
})

app.post('/api/auth/login', async (c) => {
  const input = await body(c, z.object({ email: z.string().email(), password: z.string().min(1) }))
  const account = await c.env.DB.prepare(
    'SELECT email,password_hash,password_salt FROM admin_account WHERE id = 1',
  ).first<{ email: string; password_hash: string; password_salt: string }>()
  if (
    !account ||
    account.email !== input.email.trim().toLowerCase() ||
    !(await verifyPassword(input.password, account.password_salt, account.password_hash))
  )
    return fail(c, 401, 'LOGIN_FAILED', '邮箱或密码错误')
  const token = newSessionToken()
  await c.env.DB.prepare('INSERT INTO admin_sessions (token_hash,expires_at,created_at) VALUES (?,?,?)')
    .bind(await sessionHash(token), Date.now() + SESSION_TTL, Date.now())
    .run()
  return c.json({ data: { ok: true } }, 200, {
    'Set-Cookie': `ww_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}`,
  })
})
app.post('/api/auth/init', async (c) => {
  if (await hasAdmin(c.env)) return fail(c, 409, 'ALREADY_INITIALIZED', '管理员账号已初始化')
  const input = await body(
    c,
    z.object({ email: z.string().email(), password: z.string().min(12), confirmPassword: z.string() }),
  )
  if (input.password !== input.confirmPassword) return fail(c, 422, 'PASSWORD_MISMATCH', '两次密码输入不一致')
  const { hash, salt } = await hashPassword(input.password)
  try {
    await c.env.DB.prepare(
      'INSERT INTO admin_account (id,email,password_hash,password_salt,created_at) VALUES (1,?,?,?,?)',
    )
      .bind(input.email.trim().toLowerCase(), hash, salt, Date.now())
      .run()
  } catch {
    return fail(c, 409, 'ALREADY_INITIALIZED', '管理员账号已初始化')
  }
  return c.json({ data: { ok: true } })
})
app.post('/api/auth/logout', async (c) => {
  const token = c.req.header('Cookie')?.match(/(?:^|;\s*)ww_session=([^;]+)/)?.[1]
  if (token)
    await c.env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash = ?')
      .bind(await sessionHash(token))
      .run()
  return c.json({ data: { ok: true } }, 200, {
    'Set-Cookie': 'ww_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
  })
})

app.get('/healthz', async (c) => {
  const result = await db(c.env).get<{ ok: number }>(sql`SELECT 1 AS ok`)
  return c.json({ ok: result?.ok === 1 })
})

app.get('/api/dashboard', async (c) => {
  const database = db(c.env)
  const [[sourceCount], [nodeCount], [profileCount], recentJobs] = await Promise.all([
    database.select({ value: count() }).from(sources).where(eq(sources.kind, 'url')),
    database.select({ value: count() }).from(nodes),
    database.select({ value: count() }).from(profiles),
    database.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(8),
  ])
  return ok(c, { sources: sourceCount.value, nodes: nodeCount.value, profiles: profileCount.value, recentJobs })
})

app.get('/api/sources', async (c) => {
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

app.post('/api/sources', async (c) => {
  const input = await body(c, sourceCreateSchema)
  const database = db(c.env)
  const [{ value }] = await database.select({ value: count() }).from(sources).where(eq(sources.kind, 'url'))
  if (Number(value) >= 20) return fail(c, 409, 'SOURCE_LIMIT', '节点源数量已达到 20 个')
  assertRemoteUrl(input.url)
  const now = new Date()
  const source = {
    id: crypto.randomUUID(),
    name: input.name,
    kind: 'url' as const,
    url: input.url,
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

app.patch('/api/sources/:id', async (c) => {
  const input = await body(c, sourceUpdateSchema)
  const current = await db(c.env)
    .select()
    .from(sources)
    .where(eq(sources.id, c.req.param('id')))
    .get()
  if (!current) return fail(c, 404, 'SOURCE_NOT_FOUND', '节点源不存在')
  if (current.kind !== 'url') return fail(c, 403, 'SYSTEM_SOURCE', '系统节点源不能修改')
  if (input.url) assertRemoteUrl(input.url)
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
  if (input.url) {
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

app.delete('/api/sources/:id', async (c) => {
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

app.post('/api/sources/:id/refresh', async (c) => {
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

app.post('/api/nodes', async (c) => {
  const input = await body(c, nodeCreateSchema)
  const database = db(c.env)
  const manualSource = await database
    .select({ id: sources.id })
    .from(sources)
    .where(eq(sources.id, MANUAL_SOURCE_ID))
    .get()
  if (!manualSource) return fail(c, 500, 'MIGRATION_REQUIRED', '数据库迁移未完成')
  const [{ value }] = await database.select({ value: count() }).from(nodes)
  if (Number(value) >= 2000) return fail(c, 409, 'NODE_LIMIT', '全局节点数量已达到 2000 个')

  const config = buildManualConfig(input.connection)
  const nodeFingerprint = await fingerprint(config)
  const duplicate = await database
    .select({ id: nodes.id })
    .from(nodes)
    .where(eq(nodes.fingerprint, nodeFingerprint))
    .get()
  if (duplicate) return fail(c, 409, 'NODE_DUPLICATE', '相同连接参数的节点已存在')

  const id = crypto.randomUUID()
  const now = Date.now()
  const [{ position }] = await database
    .select({ position: sql<number>`coalesce(max(${sourceNodes.position}), -1) + 1` })
    .from(sourceNodes)
    .where(eq(sourceNodes.sourceId, MANUAL_SOURCE_ID))
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO nodes (id, fingerprint, protocol, server, port, config, alias, tags, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    ).bind(
      id,
      nodeFingerprint,
      config.type,
      config.server,
      config.port,
      JSON.stringify(config),
      JSON.stringify([...new Set(input.tags)]),
      input.enabled ? 1 : 0,
      now,
      now,
    ),
    c.env.DB.prepare('INSERT INTO source_nodes (source_id, node_id, original_name, position) VALUES (?, ?, ?, ?)').bind(
      MANUAL_SOURCE_ID,
      id,
      config.name,
      Number(position),
    ),
    c.env.DB.prepare('UPDATE sources SET node_count = node_count + 1, updated_at = ? WHERE id = ?').bind(
      now,
      MANUAL_SOURCE_ID,
    ),
  ])
  await enqueueAffectedProfiles(c.env, MANUAL_SOURCE_ID)
  return c.json(
    {
      data: {
        node: {
          id,
          name: config.name,
          alias: null,
          protocol: config.type,
          server: config.server,
          port: config.port,
          tags: [...new Set(input.tags)],
          enabled: input.enabled,
          updatedAt: new Date(now),
          management: 'manual',
          canEditConnection: true,
          canDelete: true,
        },
      },
    },
    201,
  )
})

app.get('/api/nodes', async (c) => {
  const page = Math.max(1, Number(c.req.query('page')) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query('pageSize')) || 50))
  const query = c.req.query('q')?.trim()
  const protocol = c.req.query('protocol')?.trim()
  const tag = c.req.query('tag')?.trim()
  const sourceId = c.req.query('sourceId')?.trim()
  const enabled = c.req.query('enabled')
  const filters = and(
    query
      ? or(like(nodes.alias, `%${query}%`), like(nodes.server, `%${query}%`), sql`${nodes.config} LIKE ${`%${query}%`}`)
      : undefined,
    protocol ? eq(nodes.protocol, protocol) : undefined,
    tag ? sql`${nodes.tags} LIKE ${`%"${tag.replaceAll('"', '')}"%`}` : undefined,
    enabled === 'true' ? eq(nodes.enabled, true) : enabled === 'false' ? eq(nodes.enabled, false) : undefined,
    sourceId
      ? sql`EXISTS (SELECT 1 FROM source_nodes sn WHERE sn.node_id = ${nodes.id} AND sn.source_id = ${sourceId})`
      : undefined,
  )
  const database = db(c.env)
  const [rows, [{ total }]] = await Promise.all([
    database
      .select()
      .from(nodes)
      .where(filters)
      .orderBy(asc(nodes.protocol), asc(nodes.server))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    database.select({ total: count() }).from(nodes).where(filters),
  ])
  const kinds = await nodeKinds(
    c.env,
    rows.map((node) => node.id),
  )
  return ok(c, {
    items: rows.map(({ config, ...node }) => {
      const nodeManagement = management(kinds.get(node.id) || [])
      return {
        ...node,
        name: node.alias || config.name,
        management: nodeManagement,
        canEditConnection: nodeManagement === 'manual',
        canDelete: nodeManagement === 'manual' || nodeManagement === 'mixed',
      }
    }),
    page,
    pageSize,
    total,
  })
})

app.patch('/api/nodes/batch', async (c) => {
  const input = await body(c, nodeBatchSchema)
  const placeholders = input.ids.map(() => '?').join(',')
  await c.env.DB.prepare(`UPDATE nodes SET enabled = ?, updated_at = ? WHERE id IN (${placeholders})`)
    .bind(input.enabled ? 1 : 0, Date.now(), ...input.ids)
    .run()
  await enqueueProfilesForNodes(c.env, input.ids)
  return ok(c, { updated: input.ids.length })
})

app.get('/api/nodes/:id', async (c) => {
  const current = await db(c.env)
    .select()
    .from(nodes)
    .where(eq(nodes.id, c.req.param('id')))
    .get()
  if (!current) return fail(c, 404, 'NODE_NOT_FOUND', '节点不存在')
  const kinds = await nodeKinds(c.env, [current.id])
  const nodeManagement = management(kinds.get(current.id) || [])
  const { config, ...safe } = current
  return ok(c, {
    ...safe,
    name: safe.alias || config.name,
    management: nodeManagement,
    canEditConnection: nodeManagement === 'manual',
    canDelete: nodeManagement === 'manual' || nodeManagement === 'mixed',
    connection: nodeManagement === 'manual' ? connectionView(config) : null,
  })
})

app.patch('/api/nodes/:id', async (c) => {
  const input = await body(c, nodeUpdateSchema)
  const id = c.req.param('id')
  const current = await db(c.env).select().from(nodes).where(eq(nodes.id, id)).get()
  if (!current) return fail(c, 404, 'NODE_NOT_FOUND', '节点不存在')
  const kinds = await nodeKinds(c.env, [id])
  const nodeManagement = management(kinds.get(id) || [])
  if (input.connection && nodeManagement !== 'manual')
    return fail(c, 409, 'NODE_MANAGED_BY_SOURCE', '订阅管理的连接参数不能修改')
  const config = input.connection ? buildManualConfig(input.connection, current.config) : current.config
  const nodeFingerprint = input.connection ? await fingerprint(config) : current.fingerprint
  if (input.connection) {
    const duplicate = await db(c.env)
      .select({ id: nodes.id })
      .from(nodes)
      .where(eq(nodes.fingerprint, nodeFingerprint))
      .get()
    if (duplicate && duplicate.id !== id) return fail(c, 409, 'NODE_DUPLICATE', '相同连接参数的节点已存在')
  }
  const tags = input.tags ? [...new Set(input.tags)] : undefined
  await db(c.env)
    .update(nodes)
    .set({
      alias: input.alias === undefined ? undefined : input.alias || null,
      tags,
      enabled: input.enabled,
      fingerprint: nodeFingerprint,
      protocol: config.type,
      server: config.server,
      port: config.port,
      config,
      updatedAt: new Date(),
    })
    .where(eq(nodes.id, id))
  if (input.connection)
    await db(c.env)
      .update(sourceNodes)
      .set({ originalName: config.name })
      .where(and(eq(sourceNodes.sourceId, MANUAL_SOURCE_ID), eq(sourceNodes.nodeId, id)))
  await enqueueProfilesForNode(c.env, id)
  const updated = await db(c.env).select().from(nodes).where(eq(nodes.id, id)).get()
  const { config: updatedConfig, ...safe } = updated!
  return ok(c, {
    ...safe,
    name: safe.alias || updatedConfig.name,
    management: nodeManagement,
    canEditConnection: nodeManagement === 'manual',
    canDelete: nodeManagement === 'manual' || nodeManagement === 'mixed',
  })
})

app.delete('/api/nodes/:id', async (c) => {
  const id = c.req.param('id')
  const current = await db(c.env).select({ id: nodes.id }).from(nodes).where(eq(nodes.id, id)).get()
  if (!current) return fail(c, 404, 'NODE_NOT_FOUND', '节点不存在')
  const kinds = await nodeKinds(c.env, [id])
  if (!(kinds.get(id) || []).includes('manual')) return fail(c, 409, 'NODE_MANAGED_BY_SOURCE', '订阅管理的节点不能删除')
  const [{ value }] = await db(c.env)
    .select({ value: count() })
    .from(profileSources)
    .where(eq(profileSources.sourceId, MANUAL_SOURCE_ID))
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM source_nodes WHERE source_id = ? AND node_id = ?').bind(MANUAL_SOURCE_ID, id),
    c.env.DB.prepare(
      'DELETE FROM nodes WHERE id = ? AND NOT EXISTS (SELECT 1 FROM source_nodes WHERE node_id = ?)',
    ).bind(id, id),
    c.env.DB.prepare(
      'UPDATE sources SET node_count = (SELECT count(*) FROM source_nodes WHERE source_id = ?), updated_at = ? WHERE id = ?',
    ).bind(MANUAL_SOURCE_ID, Date.now(), MANUAL_SOURCE_ID),
  ])
  await enqueueAffectedProfiles(c.env, MANUAL_SOURCE_ID)
  return ok(c, { id, affectedProfileCount: Number(value) })
})

app.get('/api/profiles', async (c) => {
  const rows = await db(c.env).select().from(profiles).orderBy(desc(profiles.createdAt))
  const result = await Promise.all(rows.map((profile) => profileView(c.env, profile, new URL(c.req.url).origin)))
  return ok(c, result)
})

app.post('/api/profiles', async (c) => {
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

app.get('/api/profiles/:id', async (c) => {
  const profile = await db(c.env)
    .select()
    .from(profiles)
    .where(eq(profiles.id, c.req.param('id')))
    .get()
  if (!profile) return fail(c, 404, 'PROFILE_NOT_FOUND', '配置不存在')
  return ok(c, await profileView(c.env, profile, new URL(c.req.url).origin, true))
})

app.patch('/api/profiles/:id', async (c) => {
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

app.delete('/api/profiles/:id', async (c) => {
  const id = c.req.param('id')
  const result = await db(c.env).delete(profiles).where(eq(profiles.id, id)).returning({ id: profiles.id })
  if (!result.length) return fail(c, 404, 'PROFILE_NOT_FOUND', '配置不存在')
  return ok(c, { id })
})

app.post('/api/profiles/:id/compile', async (c) => {
  const current = await db(c.env)
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.id, c.req.param('id')))
    .get()
  if (!current) return fail(c, 404, 'PROFILE_NOT_FOUND', '配置不存在')
  const job = await createJob(c.env, 'compile_profile', current.id)
  return c.json({ data: { jobId: job.id } }, 202)
})

app.post('/api/profiles/:id/rotate-token', async (c) => {
  const id = c.req.param('id')
  const current = await db(c.env).select().from(profiles).where(eq(profiles.id, id)).get()
  if (!current) return fail(c, 404, 'PROFILE_NOT_FOUND', '配置不存在')
  const tokenVersion = current.tokenVersion + 1
  await db(c.env).update(profiles).set({ tokenVersion, updatedAt: new Date() }).where(eq(profiles.id, id))
  const token = subscriptionToken()
  return ok(c, { subscriptionUrl: `${new URL(c.req.url).origin}/s/${id}/${token}/config.yaml` })
})

app.get('/api/jobs/:id', async (c) => {
  const job = await db(c.env)
    .select()
    .from(jobs)
    .where(eq(jobs.id, c.req.param('id')))
    .get()
  if (!job) return fail(c, 404, 'JOB_NOT_FOUND', '任务不存在')
  return ok(c, job)
})

app.get('/s/:profileId/:token/config.yaml', async (c) => {
  const profile = await db(c.env)
    .select()
    .from(profiles)
    .where(and(eq(profiles.id, c.req.param('profileId')), eq(profiles.enabled, true)))
    .get()
  if (!profile?.compiledYaml) return c.notFound()
  const expected = subscriptionToken()
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
  if (response.status === 404 && c.req.method === 'GET') {
    const url = new URL(c.req.url)
    url.pathname = '/index.html'
    response = await c.env.ASSETS.fetch(new Request(url, c.req.raw))
  }
  return response
}

app.get('*', (c) => (c.req.path.startsWith('/api/') ? fail(c, 404, 'NOT_FOUND', '接口不存在') : adminAsset(c)))

app.notFound((c) =>
  c.req.path.startsWith('/api/') ? fail(c, 404, 'NOT_FOUND', '接口不存在') : c.text('Not found', 404),
)
app.onError((error, c) => fail(c, 500, 'INTERNAL_ERROR', error.message || '服务异常'))

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<QueueMessage>, env: Env) {
    for (const message of batch.messages) await processQueueMessage(env, message.body)
  },
} satisfies ExportedHandler<Env, QueueMessage>
