import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { jobs, nodes, profileNodeExclusions, profiles, profileSources, sourceNodes, sources } from './db'
import type { JobType, QueueMessage } from './db'
import { generateMihomoConfig, parseProxyText } from './proxy'
import { assertRemoteUrl } from './security'

const MAX_SOURCE_BYTES = 1024 * 1024

export function parseSubscriptionUserinfo(value: string | null) {
  if (!value) return null
  const result: Partial<Record<'upload' | 'download' | 'total' | 'expire', number>> = {}
  for (const part of value.split(';')) {
    const [key, raw] = part.trim().split('=', 2)
    if (!['upload', 'download', 'total', 'expire'].includes(key)) continue
    const number = Number(raw)
    const validExpire = key !== 'expire' || (number <= 8_640_000_000 && Number.isFinite(new Date(number * 1000).getTime()))
    if (Number.isSafeInteger(number) && number >= 0 && validExpire)
      result[key as 'upload' | 'download' | 'total' | 'expire'] = number
  }
  return Object.keys(result).length ? result : null
}

export function db(env: Env) {
  return drizzle(env.DB)
}

export async function createJob(env: Env, type: JobType, entityId: string) {
  const job = { id: crypto.randomUUID(), type, entityId, status: 'pending' as const, createdAt: new Date() }
  await db(env).insert(jobs).values(job)
  try {
    await env.JOBS.send({ jobId: job.id, type, entityId } satisfies QueueMessage)
  } catch (error) {
    await db(env)
      .update(jobs)
      .set({ status: 'failed', error: '任务入队失败', finishedAt: new Date() })
      .where(eq(jobs.id, job.id))
    throw error
  }
  return job
}

async function readResponse(response: Response) {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > MAX_SOURCE_BYTES) {
      await reader.cancel()
      throw new Error('订阅内容超过 1 MiB')
    }
    chunks.push(value)
  }
  const merged = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(merged)
}

async function fetchSource(urlValue: string, etag: string | null, lastModified: string | null) {
  let url = assertRemoteUrl(urlValue)
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const headers = new Headers({ Accept: 'text/yaml,text/plain,*/*', 'User-Agent': 'mihomo' })
    if (etag) headers.set('If-None-Match', etag)
    if (lastModified) headers.set('If-Modified-Since', lastModified)
    const response = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(15_000) })
    if (response.status === 304)
      return { notModified: true as const, subscriptionInfo: parseSubscriptionUserinfo(response.headers.get('Subscription-Userinfo')) }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('Location')
      if (!location || redirect === 3) throw new Error('订阅重定向次数过多')
      url = assertRemoteUrl(new URL(location, url).toString())
      continue
    }
    if (!response.ok) throw new Error(`订阅服务器返回 HTTP ${response.status}`)
    return {
      notModified: false as const,
      text: await readResponse(response),
      etag: response.headers.get('ETag'),
      lastModified: response.headers.get('Last-Modified'),
      subscriptionInfo: parseSubscriptionUserinfo(response.headers.get('Subscription-Userinfo')),
    }
  }
  throw new Error('订阅获取失败')
}

async function ensureNodeCapacity(env: Env, fingerprints: string[]) {
  const database = db(env)
  const [{ count }] = await database.select({ count: sql<number>`count(*)` }).from(nodes)
  let existing = 0
  for (let index = 0; index < fingerprints.length; index += 90) {
    const chunk = fingerprints.slice(index, index + 90)
    const [{ count: chunkCount }] = await database
      .select({ count: sql<number>`count(*)` })
      .from(nodes)
      .where(inArray(nodes.fingerprint, chunk))
    existing += Number(chunkCount)
  }
  if (Number(count) + fingerprints.length - existing > 2000) throw new Error('全局节点数量超过 2000')
}

async function replaceSourceNodes(
  env: Env,
  sourceId: string,
  parsed: Awaited<ReturnType<typeof parseProxyText>>,
  responseMeta?: {
    etag: string | null
    lastModified: string | null
    subscriptionInfo: ReturnType<typeof parseSubscriptionUserinfo>
  },
) {
  await ensureNodeCapacity(
    env,
    parsed.nodes.map((node) => node.fingerprint),
  )
  const now = Date.now()
  const statements: D1PreparedStatement[] = []
  for (const node of parsed.nodes) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO nodes (id, fingerprint, protocol, server, port, config, alias, tags, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, '[]', 1, ?, ?)
         ON CONFLICT(fingerprint) DO UPDATE SET protocol=excluded.protocol, server=excluded.server, port=excluded.port, config=excluded.config, updated_at=excluded.updated_at`,
      ).bind(
        node.fingerprint,
        node.fingerprint,
        node.config.type,
        node.config.server,
        node.config.port,
        JSON.stringify(node.config),
        now,
        now,
      ),
    )
  }
  statements.push(env.DB.prepare('DELETE FROM source_nodes WHERE source_id = ?').bind(sourceId))
  parsed.nodes.forEach((node, position) => {
    statements.push(
      env.DB.prepare(
        `INSERT INTO source_nodes (source_id, node_id, original_name, position)
         SELECT ?, id, ?, ? FROM nodes WHERE fingerprint = ?`,
      ).bind(sourceId, node.config.name, position, node.fingerprint),
    )
  })
  const source = await db(env).select().from(sources).where(eq(sources.id, sourceId)).get()
  if (!source) throw new Error('节点源不存在')
  const nextRefresh =
    source.kind === 'url' && source.enabled && source.refreshIntervalHours > 0
      ? now + source.refreshIntervalHours * 3_600_000
      : null
  statements.push(
    env.DB.prepare(
      `UPDATE sources SET url=COALESCE(pending_url, url), pending_url=NULL, status='ready', warning=?, error=NULL, node_count=?, etag=?, last_modified=?, upload_bytes=?, download_bytes=?, total_bytes=?, expire_at=?, info_refreshed_at=?, last_refreshed_at=?, next_refresh_at=?, updated_at=? WHERE id=?`,
    ).bind(
      parsed.warnings.join('\n') || null,
      parsed.nodes.length,
      responseMeta?.etag ?? source.etag,
      responseMeta?.lastModified ?? source.lastModified,
      responseMeta?.subscriptionInfo?.upload ?? null,
      responseMeta?.subscriptionInfo?.download ?? null,
      responseMeta?.subscriptionInfo?.total ?? null,
      responseMeta?.subscriptionInfo?.expire ?? null,
      responseMeta?.subscriptionInfo ? now : null,
      now,
      nextRefresh,
      now,
      sourceId,
    ),
  )
  statements.push(
    env.DB.prepare(
      'DELETE FROM nodes WHERE NOT EXISTS (SELECT 1 FROM source_nodes WHERE source_nodes.node_id = nodes.id)',
    ),
  )
  await env.DB.batch(statements)
}

export async function enqueueAffectedProfiles(env: Env, sourceId: string) {
  const affected = await db(env)
    .select({ id: profileSources.profileId })
    .from(profileSources)
    .where(eq(profileSources.sourceId, sourceId))
  for (const profile of affected) await createJob(env, 'compile_profile', profile.id)
}

export async function enqueueProfilesForNode(env: Env, nodeId: string) {
  return enqueueProfilesForNodes(env, [nodeId])
}

export async function enqueueProfilesForNodes(env: Env, nodeIds: string[]) {
  if (!nodeIds.length) return
  const affected = await db(env)
    .select({ id: profileSources.profileId })
    .from(profileSources)
    .innerJoin(sourceNodes, eq(sourceNodes.sourceId, profileSources.sourceId))
    .where(inArray(sourceNodes.nodeId, nodeIds))
  for (const profileId of new Set(affected.map((profile) => profile.id)))
    await createJob(env, 'compile_profile', profileId)
}

export async function refreshSource(env: Env, sourceId: string) {
  const database = db(env)
  const source = await database.select().from(sources).where(eq(sources.id, sourceId)).get()
  if (!source) throw new Error('节点源不存在')
  await database
    .update(sources)
    .set({ status: 'refreshing', error: null, updatedAt: new Date() })
    .where(eq(sources.id, sourceId))

  const candidateUrl = source.pendingUrl || source.url
  const response =
    source.kind === 'url'
      ? await fetchSource(
          candidateUrl!,
          source.pendingUrl ? null : source.etag,
          source.pendingUrl ? null : source.lastModified,
        )
      : null
  if (response?.notModified) {
    if (source.pendingUrl) throw new Error('新订阅地址无法验证')
    const now = new Date()
    await database
      .update(sources)
      .set({
        status: 'ready',
        error: null,
        ...(response.subscriptionInfo
          ? {
              uploadBytes: response.subscriptionInfo.upload ?? null,
              downloadBytes: response.subscriptionInfo.download ?? null,
              totalBytes: response.subscriptionInfo.total ?? null,
              expireAt: response.subscriptionInfo.expire ?? null,
              infoRefreshedAt: new Date(),
            }
          : {}),
        lastRefreshedAt: now,
        nextRefreshAt:
          source.refreshIntervalHours > 0 ? new Date(now.getTime() + source.refreshIntervalHours * 3_600_000) : null,
        updatedAt: now,
      })
      .where(eq(sources.id, sourceId))
    return
  }

  const parsed = await parseProxyText(response?.text ?? source.content ?? '')
  await replaceSourceNodes(env, sourceId, parsed, response && !response.notModified ? response : undefined)
  await enqueueAffectedProfiles(env, sourceId)
}

export async function compileProfile(env: Env, profileId: string) {
  const database = db(env)
  const profile = await database.select().from(profiles).where(eq(profiles.id, profileId)).get()
  if (!profile) throw new Error('配置不存在')

  const selected = await database
    .select({
      id: nodes.id,
      config: nodes.config,
      alias: nodes.alias,
      tags: nodes.tags,
      originalName: sourceNodes.originalName,
    })
    .from(nodes)
    .innerJoin(sourceNodes, eq(sourceNodes.nodeId, nodes.id))
    .innerJoin(
      profileSources,
      and(eq(profileSources.sourceId, sourceNodes.sourceId), eq(profileSources.profileId, profileId)),
    )
    .innerJoin(sources, eq(sources.id, sourceNodes.sourceId))
    .leftJoin(
      profileNodeExclusions,
      and(eq(profileNodeExclusions.nodeId, nodes.id), eq(profileNodeExclusions.profileId, profileId)),
    )
    .where(
      and(
        eq(nodes.enabled, true),
        eq(sources.enabled, true),
        isNull(profileNodeExclusions.nodeId),
        profile.protocols.length ? inArray(nodes.protocol, profile.protocols) : undefined,
      ),
    )
    .orderBy(asc(sourceNodes.position), asc(nodes.createdAt))

  const unique = new Map<string, (typeof selected)[number]>()
  for (const node of selected) {
    if (profile.tags.length && !profile.tags.some((tag) => node.tags.includes(tag))) continue
    if (!unique.has(node.id)) unique.set(node.id, node)
  }

  const yaml = generateMihomoConfig(
    [...unique.values()].map((node) => ({ config: node.config, name: node.alias || node.originalName })),
    { dnsMode: profile.dnsMode, ruleModules: profile.ruleModules },
  )
  const revision = profile.revision + 1
  const now = new Date()
  await database
    .update(profiles)
    .set({ revision, compiledYaml: yaml, compiledAt: now, error: null, updatedAt: now })
    .where(eq(profiles.id, profileId))
  try {
    await env.KV.put(`profile:${profileId}:revision:${revision}`, yaml)
  } catch {
    // D1 保留完整配置，KV 故障不会使订阅不可用。
  }
}

export async function processQueueMessage(env: Env, message: QueueMessage) {
  const database = db(env)
  const job = await database.select().from(jobs).where(eq(jobs.id, message.jobId)).get()
  if (!job || job.status === 'succeeded' || job.status === 'failed') return
  await database
    .update(jobs)
    .set({ status: 'running', startedAt: new Date(), error: null })
    .where(eq(jobs.id, message.jobId))
  try {
    if (message.type === 'refresh_source') await refreshSource(env, message.entityId)
    else await compileProfile(env, message.entityId)
    await database.update(jobs).set({ status: 'succeeded', finishedAt: new Date() }).where(eq(jobs.id, message.jobId))
  } catch (error) {
    const text = error instanceof Error ? error.message : '任务执行失败'
    await database
      .update(jobs)
      .set({ status: 'failed', error: text, finishedAt: new Date() })
      .where(eq(jobs.id, message.jobId))
    if (message.type === 'refresh_source') {
      await database
        .update(sources)
        .set({ status: 'error', error: text, pendingUrl: null, updatedAt: new Date() })
        .where(eq(sources.id, message.entityId))
    } else {
      await database
        .update(profiles)
        .set({ error: text, updatedAt: new Date() })
        .where(eq(profiles.id, message.entityId))
    }
  }
}

export async function enqueueDueSources(env: Env, now = new Date()) {
  const database = db(env)
  const due = await database
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.kind, 'url'), eq(sources.enabled, true), lte(sources.nextRefreshAt, now)))
    .limit(20)
  for (const source of due) {
    const active = await database
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.type, 'refresh_source'),
          eq(jobs.entityId, source.id),
          or(eq(jobs.status, 'pending'), eq(jobs.status, 'running')),
        ),
      )
      .get()
    if (!active) await createJob(env, 'refresh_source', source.id)
  }
}
