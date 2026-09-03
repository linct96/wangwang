import { and, asc, eq, inArray, lte, or, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { jobs, nodeEntries, nodes, profiles, profileSources, sourceEntries, sources } from './db'
import type { JobType, QueueMessage, TemplateId } from './db'
import { parseProxyText } from './proxy/index'
import { assertRemoteUrl } from './security'
import { matchesAnyTag, mergeTagViews } from './tag-model'
import { entryTagViews, profileFilterTagIds } from './tag-store'
import { renderMihomoConfig } from './templates/renderer'
import { resolveTemplate } from './templates/resolver'

const MAX_SOURCE_BYTES = 1024 * 1024

async function runBatches(env: Env, statements: D1PreparedStatement[]) {
  for (let index = 0; index < statements.length; index += 80) await env.DB.batch(statements.slice(index, index + 80))
}

export async function cleanupOrphanNodes(env: Env) {
  await env.DB.batch([
    env.DB.prepare(
      'DELETE FROM node_entries WHERE NOT EXISTS (SELECT 1 FROM source_entries WHERE source_entries.entry_id = node_entries.id)',
    ),
    env.DB.prepare(
      'DELETE FROM nodes WHERE NOT EXISTS (SELECT 1 FROM node_entries WHERE node_entries.node_id = nodes.id)',
    ),
    env.DB.prepare(
      'DELETE FROM tags WHERE NOT EXISTS (SELECT 1 FROM node_entry_tags WHERE node_entry_tags.tag_id = tags.id) AND NOT EXISTS (SELECT 1 FROM source_tags WHERE source_tags.tag_id = tags.id)',
    ),
  ])
}

export function parseSubscriptionUserinfo(value: string | null) {
  if (!value) return null
  const result: Partial<Record<'upload' | 'download' | 'total' | 'expire', number>> = {}
  for (const part of value.split(';')) {
    const [key, raw] = part.trim().split('=', 2)
    if (!['upload', 'download', 'total', 'expire'].includes(key)) continue
    const number = Number(raw)
    const validExpire =
      key !== 'expire' || (number > 0 && number <= 8_640_000_000 && Number.isFinite(new Date(number * 1000).getTime()))
    if (Number.isSafeInteger(number) && number >= 0 && validExpire)
      result[key as 'upload' | 'download' | 'total' | 'expire'] = number
  }
  return Object.keys(result).length ? result : null
}

export function parseContentDispositionFilename(value: string | null) {
  if (!value) return null
  const extended = /(?:^|;)\s*filename\*\s*=\s*(?:"([^"]*)"|([^;]*))/i.exec(value)
  const fallback = /(?:^|;)\s*filename\s*=\s*(?:"([^"]*)"|([^;]*))/i.exec(value)
  for (const match of [extended, fallback]) {
    if (!match) continue
    const raw = (match[1] ?? match[2]).trim()
    try {
      const encoded = match === extended ? raw.replace(/^[^']*'[^']*'/, '') : raw
      const filename = (match === extended ? decodeURIComponent(encoded) : encoded)
        .split(/[\\/]/)
        .pop()
        // eslint-disable-next-line no-control-regex
        ?.replace(/[\x00-\x1f\x7f]/g, '')
        .trim()
      if (filename) return filename.slice(0, 60)
    } catch {
      // filename* 解码失败时继续尝试普通 filename。
    }
  }
  return null
}

function subscriptionMetadata(headers: Headers, fallbackName: string | null = null) {
  return {
    name: parseContentDispositionFilename(headers.get('Content-Disposition')) || fallbackName,
    subscriptionInfo: parseSubscriptionUserinfo(headers.get('Subscription-Userinfo')),
  }
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

export async function fetchSource(
  urlValue: string,
  userAgent: string,
  etag: string | null,
  lastModified: string | null,
) {
  let url = assertRemoteUrl(urlValue)
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const headers = new Headers({ Accept: 'text/yaml,text/plain,*/*', 'User-Agent': userAgent })
    if (etag) headers.set('If-None-Match', etag)
    if (lastModified) headers.set('If-Modified-Since', lastModified)
    const response = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(15_000) })
    if (response.status === 304)
      return {
        notModified: true as const,
        ...subscriptionMetadata(response.headers),
      }
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
      ...subscriptionMetadata(response.headers, url.hostname),
    }
  }
  throw new Error('订阅获取失败')
}

async function ensureNodeCapacity(env: Env, fingerprints: string[]) {
  fingerprints = [...new Set(fingerprints)]
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

async function replaceSourceEntries(
  env: Env,
  sourceId: string,
  parsed: Awaited<ReturnType<typeof parseProxyText>>,
  responseMeta?: {
    name: string | null
    etag: string | null
    lastModified: string | null
    subscriptionInfo: ReturnType<typeof parseSubscriptionUserinfo>
  },
) {
  const source = await db(env).select().from(sources).where(eq(sources.id, sourceId)).get()
  if (!source) throw new Error('节点源不存在')
  const parsedNodes = parsed.nodes
  await ensureNodeCapacity(
    env,
    parsedNodes.map((node) => node.fingerprint),
  )
  const now = Date.now()
  for (let index = 0; index < parsedNodes.length; index += 40) {
    const chunk = parsedNodes.slice(index, index + 40)
    await env.DB.batch(
      chunk.map((node) =>
        env.DB.prepare(
          `INSERT INTO nodes (id, fingerprint, protocol, server, port, config, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(fingerprint) DO UPDATE SET protocol=excluded.protocol, server=excluded.server, port=excluded.port, config=excluded.config, updated_at=excluded.updated_at`,
        ).bind(
          crypto.randomUUID(),
          node.fingerprint,
          node.config.type,
          node.config.server,
          node.config.port,
          JSON.stringify(node.config),
          now,
          now,
        ),
      ),
    )
  }
  const fingerprints = parsedNodes.map((node) => node.fingerprint)
  const physicalByFingerprint = new Map<string, string>()
  for (let index = 0; index < fingerprints.length; index += 90) {
    const rows = await db(env)
      .select({ id: nodes.id, fingerprint: nodes.fingerprint })
      .from(nodes)
      .where(inArray(nodes.fingerprint, fingerprints.slice(index, index + 90)))
    for (const row of rows) physicalByFingerprint.set(row.fingerprint, row.id)
  }
  const entryByFingerprint = new Map<string, string>()
  for (let index = 0; index < fingerprints.length; index += 90) {
    const rows = await db(env)
      .select({ entryId: sourceEntries.entryId, fingerprint: nodes.fingerprint })
      .from(sourceEntries)
      .innerJoin(nodeEntries, eq(nodeEntries.id, sourceEntries.entryId))
      .innerJoin(nodes, eq(nodes.id, nodeEntries.nodeId))
      .innerJoin(sources, eq(sources.id, sourceEntries.sourceId))
      .where(
        and(
          eq(sources.kind, 'url'),
          eq(sourceEntries.sourceKey, nodes.fingerprint),
          inArray(nodes.fingerprint, fingerprints.slice(index, index + 90)),
        ),
      )
    for (const row of rows)
      if (!entryByFingerprint.has(row.fingerprint)) entryByFingerprint.set(row.fingerprint, row.entryId)
  }
  const entryIdsByFingerprint = new Map<string, string>()
  const entryStatements: D1PreparedStatement[] = []
  for (const node of parsedNodes) {
    const nodeId = physicalByFingerprint.get(node.fingerprint)
    if (!nodeId) continue
    let entryId = entryByFingerprint.get(node.fingerprint)
    if (!entryId) {
      entryId = crypto.randomUUID()
      entryStatements.push(
        env.DB.prepare(
          `INSERT INTO node_entries (id, node_id, name, alias, enabled, created_at, updated_at)
           VALUES (?, ?, ?, NULL, 1, ?, ?)`,
        ).bind(entryId, nodeId, node.config.name, now, now),
      )
    } else {
      entryStatements.push(
        env.DB.prepare('UPDATE node_entries SET node_id = ?, name = ?, updated_at = ? WHERE id = ?').bind(
          nodeId,
          node.config.name,
          now,
          entryId,
        ),
      )
    }
    entryIdsByFingerprint.set(node.fingerprint, entryId)
  }
  if (entryStatements.length) await runBatches(env, entryStatements)
  const relationStatements: D1PreparedStatement[] = [
    env.DB.prepare('DELETE FROM source_entries WHERE source_id = ?').bind(sourceId),
  ]
  parsedNodes.forEach((node, position) => {
    const entryId = entryIdsByFingerprint.get(node.fingerprint)
    if (!entryId) return
    relationStatements.push(
      env.DB.prepare(
        `INSERT INTO source_entries (source_id, entry_id, source_key, original_name, position)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(sourceId, entryId, node.fingerprint, node.config.name, position),
    )
  })
  const nextRefresh =
    source.kind === 'url' && source.enabled && source.refreshIntervalHours > 0
      ? now + source.refreshIntervalHours * 3_600_000
      : null
  relationStatements.push(
    env.DB.prepare(
      `UPDATE sources SET url=COALESCE(pending_url, url), pending_url=NULL, name=COALESCE(?, name), status='ready', warning=?, error=NULL, node_count=?, etag=?, last_modified=?, upload_bytes=?, download_bytes=?, total_bytes=?, expire_at=?, info_refreshed_at=?, last_refreshed_at=?, next_refresh_at=?, updated_at=? WHERE id=?`,
    ).bind(
      responseMeta?.name ?? null,
      parsed.warnings.join('\n') || null,
      parsedNodes.length,
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
  await runBatches(env, relationStatements)
  await cleanupOrphanNodes(env)
}

export async function enqueueAffectedProfiles(env: Env, sourceId: string) {
  const affected = await db(env)
    .select({ id: profileSources.profileId })
    .from(profileSources)
    .where(eq(profileSources.sourceId, sourceId))
  for (const profile of affected) await createJob(env, 'compile_profile', profile.id)
}

export async function enqueueProfilesForEntry(env: Env, entryId: string) {
  return enqueueProfilesForEntries(env, [entryId])
}

export async function enqueueProfilesForEntries(env: Env, entryIds: string[]) {
  if (!entryIds.length) return
  const affected = await db(env)
    .select({ id: profileSources.profileId })
    .from(profileSources)
    .innerJoin(sourceEntries, eq(sourceEntries.sourceId, profileSources.sourceId))
    .where(inArray(sourceEntries.entryId, entryIds))
  for (const profileId of new Set(affected.map((profile) => profile.id)))
    await createJob(env, 'compile_profile', profileId)
}

export async function enqueueProfilesForTemplate(env: Env, templateId: string) {
  const affected = await db(env)
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.templateId, templateId as TemplateId))
  const jobs = []
  for (const profile of affected) jobs.push(await createJob(env, 'compile_profile', profile.id))
  return jobs
}

export async function refreshSource(env: Env, sourceId: string) {
  const database = db(env)
  const source = await database.select().from(sources).where(eq(sources.id, sourceId)).get()
  if (!source) throw new Error('节点源不存在')
  if (source.kind !== 'url') throw new Error('系统节点源不能刷新')
  await database
    .update(sources)
    .set({ status: 'refreshing', error: null, updatedAt: new Date() })
    .where(eq(sources.id, sourceId))

  const candidateUrl = source.pendingUrl || source.url
  const response = await fetchSource(
    candidateUrl!,
    source.userAgent,
    source.pendingUrl ? null : source.etag,
    source.pendingUrl ? null : source.lastModified,
  )
  if (response.notModified) {
    if (source.pendingUrl) throw new Error('新订阅地址无法验证')
    const now = new Date()
    await database
      .update(sources)
      .set({
        name: response.name ?? undefined,
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

  const parsed = await parseProxyText(response.text, source.nodeNameFilter)
  await replaceSourceEntries(env, sourceId, parsed, response)
  await enqueueAffectedProfiles(env, sourceId)
}

export async function selectProfileNodes(env: Env, profile: typeof profiles.$inferSelect) {
  const selected = await db(env)
    .select({
      id: nodeEntries.id,
      config: nodes.config,
      alias: nodeEntries.alias,
      entryName: nodeEntries.name,
      sourceId: sourceEntries.sourceId,
      originalName: sourceEntries.originalName,
      position: sourceEntries.position,
      createdAt: nodeEntries.createdAt,
    })
    .from(nodeEntries)
    .innerJoin(nodes, eq(nodes.id, nodeEntries.nodeId))
    .innerJoin(sourceEntries, eq(sourceEntries.entryId, nodeEntries.id))
    .innerJoin(
      profileSources,
      and(eq(profileSources.sourceId, sourceEntries.sourceId), eq(profileSources.profileId, profile.id)),
    )
    .innerJoin(sources, eq(sources.id, sourceEntries.sourceId))
    .where(and(eq(nodeEntries.enabled, true), eq(sources.enabled, true)))
    .orderBy(asc(sourceEntries.position), asc(nodeEntries.createdAt))

  const filterTagIds = await profileFilterTagIds(env, profile.id)
  const entryIds = [...new Set(selected.map((node) => node.id))]
  const sourcePairs = [
    ...new Map(
      selected.map((node) => [`${node.id}:${node.sourceId}`, { entryId: node.id, sourceId: node.sourceId }]),
    ).values(),
  ]
  const views = await entryTagViews(env, entryIds, sourcePairs)
  const unique = new Map<string, (typeof selected)[number]>()
  for (const node of selected) {
    const view = views.get(node.id) || { direct: [], inherited: [] }
    const effectiveTagIds = mergeTagViews(view.direct, view.inherited).map((tag) => tag.id)
    if (!matchesAnyTag(effectiveTagIds, filterTagIds)) continue
    if (!unique.has(node.id)) unique.set(node.id, node)
  }
  return [...unique.values()].map((node) => ({
    config: node.config,
    name: node.alias || node.originalName || node.entryName,
  }))
}

export async function compileProfile(env: Env, profileId: string) {
  const database = db(env)
  const profile = await database.select().from(profiles).where(eq(profiles.id, profileId)).get()
  if (!profile) throw new Error('配置不存在')
  const template = await resolveTemplate(env, profile.templateId)
  if (!template) throw new Error('订阅模板不存在')

  const yaml = renderMihomoConfig({ nodes: await selectProfileNodes(env, profile), template })
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
