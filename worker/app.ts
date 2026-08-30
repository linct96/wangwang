import { Hono } from 'hono'
import type { Context } from 'hono'
import { and, count, desc, eq, sql } from 'drizzle-orm'
import { jobs, nodes, profiles, sources } from './db'
import { db } from './tasks'
import { fail, ok } from './http'
import { authenticated, authRouter } from './routes/auth'
import { sourcesRouter } from './routes/sources'
import { nodesRouter } from './routes/nodes'
import { profilesRouter } from './routes/profiles'
import { templatesRouter } from './routes/templates'
import { geoRouter } from './routes/geo'
import { ruleSetPresetsRouter } from './routes/rule-set-presets'
import { validOrigin, verifySubscriptionToken } from './security'

export const app = new Hono<{ Bindings: Env }>()

app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/auth/login' || c.req.path === '/api/auth/init' || c.req.path === '/api/auth/status')
    return next()
  if (!(await authenticated(c))) return fail(c, 401, 'AUTH_REQUIRED', '请先登录')
  if (!validOrigin(c.req.raw)) return fail(c, 403, 'ORIGIN_DENIED', '请求来源无效')
  await next()
})

app.route('/api/auth', authRouter)
app.route('/api/sources', sourcesRouter)
app.route('/api/nodes', nodesRouter)
app.route('/api/profiles', profilesRouter)
app.route('/api/templates', templatesRouter)
app.route('/api/geo', geoRouter)
app.route('/api/rule-set-presets', ruleSetPresetsRouter)

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

app.get('/api/jobs/:id', async (c) => {
  const job = await db(c.env)
    .select()
    .from(jobs)
    .where(eq(jobs.id, c.req.param('id')))
    .get()
  if (!job) return fail(c, 404, 'JOB_NOT_FOUND', '任务不存在')
  return ok(c, job)
})

app.get('/s/:token/config.yaml', async (c) => {
  const token = await verifySubscriptionToken(c.env.SUBSCRIPTION_TOKEN_SECRET, c.req.param('token'))
  if (!token) return c.notFound()
  const profile = await db(c.env)
    .select()
    .from(profiles)
    .where(and(eq(profiles.id, token.profileId), eq(profiles.enabled, true)))
    .get()
  if (!profile?.compiledYaml) return c.notFound()
  if (profile.tokenVersion !== token.tokenVersion) return c.notFound()
  const key = `profile:${profile.id}:revision:${profile.revision}`
  let yaml = await c.env.KV.get(key)
  if (!yaml) {
    yaml = profile.compiledYaml
    c.executionCtx.waitUntil(c.env.KV.put(key, yaml))
  }
  const filename = encodeURIComponent(`${profile.name}.yaml`).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return c.body(yaml, 200, {
    'Content-Type': 'text/yaml; charset=utf-8',
    'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
})

export async function adminAsset(c: Context<{ Bindings: Env }>) {
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
