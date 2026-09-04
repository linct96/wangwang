import { and, asc, eq, inArray, lte, or, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { jobs, nodes, physicalNodes, profiles, profileSourceBindings, sources } from './db'
import type { JobType, QueueMessage, TemplateId } from './db'
import { parseProxyText } from './proxy/index'
import { assertRemoteUrl } from './security'
import { matchesAnyTag, mergeTagViews } from './tag-model'
import { nodeTagViews, profileFilterTagIds } from './tag-store'
import { renderMihomoConfig, type SelectedSlotNode } from './templates/renderer'
import { resolveTemplate } from './templates/resolver'

const MAX_SOURCE_BYTES = 1024 * 1024

async function runBatches(env: Env, statements: D1PreparedStatement[]) {
  for (let index = 0; index < statements.length; index += 80) await env.DB.batch(statements.slice(index, index + 80))
}

export async function cleanupOrphanPhysicalNodes(env: Env) {
  await env.DB.batch([
    env.DB.prepare(
      'DELETE FROM physical_nodes WHERE NOT EXISTS (SELECT 1 FROM nodes WHERE nodes.physical_node_id = physical_nodes.id)',
    ),
    env.DB.prepare(
      'DELETE FROM tags WHERE NOT EXISTS (SELECT 1 FROM node_tags WHERE node_tags.tag_id = tags.id) AND NOT EXISTS (SELECT 1 FROM source_tags WHERE source_tags.tag_id = tags.id)',
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

async function replaceSourceNodes(
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
  const database = db(env)
  const source = await database.select().from(sources).where(eq(sources.id, sourceId)).get()
  if (!source) throw new Error('节点源不存在')
  const parsedNodes = parsed.nodes
  const [{ total }] = await database.select({ total: sql<number>`count(*)` }).from(nodes)
  const [{ current }] = await database
    .select({ current: sql<number>`count(*)` })
    .from(nodes)
    .where(eq(nodes.sourceId, sourceId))
  if (Number(total) - Number(current) + parsedNodes.length > 2000) throw new Error('全局节点数量超过 2000')

  const now = Date.now()
  for (let index = 0; index < parsedNodes.length; index += 40) {
    await env.DB.batch(
      parsedNodes.slice(index, index + 40).map((node) =>
        env.DB.prepare(
          `INSERT INTO physical_nodes (id, fingerprint, protocol, server, port, config, created_at, updated_at)
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
    const rows = await database
      .select({ id: physicalNodes.id, fingerprint: physicalNodes.fingerprint })
      .from(physicalNodes)
      .where(inArray(physicalNodes.fingerprint, fingerprints.slice(index, index + 90)))
    for (const row of rows) physicalByFingerprint.set(row.fingerprint, row.id)
  }
  const existing = await database
    .select({ id: nodes.id, fingerprint: physicalNodes.fingerprint })
    .from(nodes)
    .innerJoin(physicalNodes, eq(physicalNodes.id, nodes.physicalNodeId))
    .where(eq(nodes.sourceId, sourceId))
  const existingByFingerprint = new Map(existing.map((node) => [node.fingerprint, node.id]))
  const keptIds: string[] = []
  const statements: D1PreparedStatement[] = []
  parsedNodes.forEach((node, position) => {
    const physicalNodeId = physicalByFingerprint.get(node.fingerprint)
    if (!physicalNodeId) return
    const id = existingByFingerprint.get(node.fingerprint) || crypto.randomUUID()
    keptIds.push(id)
    if (existingByFingerprint.has(node.fingerprint))
      statements.push(
        env.DB.prepare(
          'UPDATE nodes SET physical_node_id = ?, original_name = ?, position = ?, updated_at = ? WHERE id = ?',
        ).bind(physicalNodeId, node.originalName, position, now, id),
      )
    else
      statements.push(
        env.DB.prepare(
          `INSERT INTO nodes (id, source_id, physical_node_id, original_name, alias, enabled, position, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, 1, ?, ?, ?)`,
        ).bind(id, sourceId, physicalNodeId, node.originalName, position, now, now),
      )
  })
  if (statements.length) await runBatches(env, statements)
  await env.DB.prepare(`DELETE FROM nodes WHERE source_id = ? AND id NOT IN (SELECT value FROM json_each(?))`)
    .bind(sourceId, JSON.stringify(keptIds))
    .run()

  const relationStatements: D1PreparedStatement[] = []
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
  await cleanupOrphanPhysicalNodes(env)
}

export async function enqueueAffectedProfiles(env: Env, sourceId: string) {
  const affected = await db(env)
    .select({ id: profileSourceBindings.profileId })
    .from(profileSourceBindings)
    .where(eq(profileSourceBindings.sourceId, sourceId))
  for (const id of new Set(affected.map(({ id }) => id))) await createJob(env, 'compile_profile', id)
}

export async function enqueueProfilesForNode(env: Env, nodeId: string) {
  const node = await db(env).select({ sourceId: nodes.sourceId }).from(nodes).where(eq(nodes.id, nodeId)).get()
  if (node) await enqueueAffectedProfiles(env, node.sourceId)
}

export async function enqueueProfilesForNodes(env: Env, nodeIds: string[]) {
  if (!nodeIds.length) return
  const affected = await db(env)
    .selectDistinct({ sourceId: nodes.sourceId })
    .from(nodes)
    .where(inArray(nodes.id, nodeIds))
  for (const { sourceId } of affected) await enqueueAffectedProfiles(env, sourceId)
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
  await replaceSourceNodes(env, sourceId, parsed, response)
  await enqueueAffectedProfiles(env, sourceId)
}

export async function selectProfileNodes(env: Env, profile: typeof profiles.$inferSelect): Promise<SelectedSlotNode[]> {
  const selected = await db(env)
    .select({
      slotKey: profileSourceBindings.slotKey,
      id: nodes.id,
      config: physicalNodes.config,
      alias: nodes.alias,
      originalName: nodes.originalName,
    })
    .from(nodes)
    .innerJoin(physicalNodes, eq(physicalNodes.id, nodes.physicalNodeId))
    .innerJoin(
      profileSourceBindings,
      and(eq(profileSourceBindings.sourceId, nodes.sourceId), eq(profileSourceBindings.profileId, profile.id)),
    )
    .innerJoin(sources, eq(sources.id, nodes.sourceId))
    .where(and(eq(nodes.enabled, true), eq(sources.enabled, true)))
    .orderBy(asc(nodes.position), asc(nodes.createdAt))

  const filterTagIds = await profileFilterTagIds(env, profile.id)
  const nodeIds = [...new Set(selected.map(({ id }) => id))]
  const views = await nodeTagViews(env, nodeIds)
  const result: SelectedSlotNode[] = []
  const seen = new Set<string>()
  for (const node of selected) {
    const view = views.get(node.id) || { direct: [], inherited: [] }
    const effectiveTagIds = mergeTagViews(view.direct, view.inherited).map(({ id }) => id)
    const key = `${node.slotKey}:${node.id}`
    if (!matchesAnyTag(effectiveTagIds, filterTagIds) || seen.has(key)) continue
    seen.add(key)
    result.push({
      slotKey: node.slotKey,
      nodeId: node.id,
      config: node.config,
      name: node.alias || node.originalName,
    })
  }
  return result
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
