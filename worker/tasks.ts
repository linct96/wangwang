import { and, asc, eq, gt, inArray, lte, or, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import {
  jobs,
  nodes,
  physicalNodes,
  profiles,
  profileNodeNodes,
  profileNodeSources,
  profileSlotNodes,
  profileSlotSources,
  sources,
} from './db'
import type { JobType, QueueMessage, TemplateId } from './db'
import { parseProxyText } from './proxy/index'
import { assertRemoteUrl } from './security'
import { matchesAnyTag, mergeTagViews, normalizeTagName } from './tag-model'
import { readProfileNodeBinding } from './profile-node-binding'
import { readProfileSubscriptionSources, resolveProfileProxyProviders } from './profile-proxy-providers'
import {
  readProfileSlotBindings,
  type ProfileNodeBinding,
  type ProfileNodeBindingInput,
  type ProfileSlotBinding,
  type ProfileSlotBindingInput,
} from './profile-slot-bindings'
import { nodeTagViews, profileFilterTagIds } from './tag-store'
import { renderMihomoConfig, type SelectedNode, type SelectedSlotNode } from './templates/renderer'
import { resolveTemplate } from './templates/resolver'

const MAX_SOURCE_BYTES = 1024 * 1024
export const MAX_JOB_ATTEMPTS = 4 // 首次执行 + wrangler.jsonc 中的 3 次重试。
const JOB_LEASE_MS = 16 * 60_000 // 超过 Queue 消费者的 15 分钟执行上限，崩溃后由定时恢复。
const RECOVERY_SEND_MS = 5 * 60_000

type JobLease = { id: string; token: string }
class PermanentJobError extends Error {
  readonly affectsEntity: boolean
  constructor(message: string, affectsEntity = true) {
    super(message)
    this.affectsEntity = affectsEntity
  }
}

const orphanTagsSql = `
  NOT EXISTS (SELECT 1 FROM node_tags WHERE tag_id=tags.id)
  AND NOT EXISTS (SELECT 1 FROM source_tags WHERE tag_id=tags.id)
  AND NOT EXISTS (SELECT 1 FROM profile_tag_filters WHERE tag_id=tags.id)
  AND NOT EXISTS (SELECT 1 FROM profile_node_tags WHERE tag_id=tags.id)
  AND NOT EXISTS (SELECT 1 FROM profile_slot_tags WHERE tag_id=tags.id)`

const affectedSourceProfilesSql = `
  SELECT p.id FROM profiles p WHERE
    EXISTS (SELECT 1 FROM profile_node_sources b WHERE b.profile_id=p.id AND b.source_id=?)
    OR EXISTS (SELECT 1 FROM profile_slot_sources b WHERE b.profile_id=p.id AND b.source_id=?)
    OR EXISTS (SELECT 1 FROM profile_subscription_sources b WHERE b.profile_id=p.id AND b.source_id=?)
    OR EXISTS (SELECT 1 FROM profile_node_nodes b JOIN nodes n ON n.id=b.node_id WHERE b.profile_id=p.id AND n.source_id=?)
    OR EXISTS (SELECT 1 FROM profile_slot_nodes b JOIN nodes n ON n.id=b.node_id WHERE b.profile_id=p.id AND n.source_id=?)
    OR EXISTS (SELECT 1 FROM profile_node_binding b WHERE b.profile_id=p.id AND b.mode='tag')
    OR EXISTS (SELECT 1 FROM profile_slot_bindings b WHERE b.profile_id=p.id AND b.mode='tag')`

function sourceUrl(value: string) {
  try {
    return assertRemoteUrl(value)
  } catch (error) {
    throw new PermanentJobError(error instanceof Error ? error.message : '订阅 URL 无效')
  }
}

export async function cleanupOrphanPhysicalNodes(env: Env) {
  await env.DB.batch([
    env.DB.prepare(
      'DELETE FROM physical_nodes WHERE NOT EXISTS (SELECT 1 FROM nodes WHERE nodes.physical_node_id = physical_nodes.id)',
    ),
    env.DB.prepare(`DELETE FROM tags WHERE ${orphanTagsSql}`),
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

async function dispatchJob(env: Env, job: Pick<typeof jobs.$inferSelect, 'id' | 'type' | 'entityId'>) {
  await env.JOBS.send({ jobId: job.id, type: job.type, entityId: job.entityId } satisfies QueueMessage)
  // send 成功但此处失败时可能重复投递；消费者用租约和终态检查处理，而不是假设 exactly-once。
  await db(env).update(jobs).set({ dispatchedAt: new Date() }).where(eq(jobs.id, job.id))
}

export async function createJob(env: Env, type: JobType, entityId: string) {
  const job = { id: crypto.randomUUID(), type, entityId, status: 'pending' as const, createdAt: new Date() }
  await db(env).insert(jobs).values(job)
  try {
    await dispatchJob(env, job)
  } catch {
    // 数据已持久化，不能把尚未执行的任务标成永久失败；定时恢复会重新入队。
    await db(env)
      .update(jobs)
      .set({ error: '任务等待重新入队' })
      .where(and(eq(jobs.id, job.id), eq(jobs.status, 'pending'), eq(jobs.attempts, 0)))
  }
  return job
}

async function dispatchRefreshChildren(env: Env, parentJobId: string) {
  const pending = await db(env)
    .select()
    .from(jobs)
    .where(and(eq(jobs.parentJobId, parentJobId), eq(jobs.status, 'pending'), sql`${jobs.dispatchedAt} IS NULL`))
  for (const job of pending) await dispatchJob(env, job)
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
      throw new PermanentJobError('订阅内容超过 1 MiB')
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
  let url = sourceUrl(urlValue)
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
      if (!location || redirect === 3) throw new PermanentJobError('订阅重定向次数过多或缺少跳转地址')
      try {
        url = sourceUrl(new URL(location, url).toString())
      } catch (error) {
        throw new PermanentJobError(error instanceof Error ? error.message : '订阅重定向地址无效')
      }
      continue
    }
    if (!response.ok) {
      const message = `订阅服务器返回 HTTP ${response.status}`
      if (response.status === 408 || response.status === 429 || response.status >= 500) throw new Error(message)
      throw new PermanentJobError(message)
    }
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

async function commitSourceRefresh(
  env: Env,
  source: typeof sources.$inferSelect,
  parsed: Awaited<ReturnType<typeof parseProxyText>> | null,
  response: Awaited<ReturnType<typeof fetchSource>>,
  lease: JobLease,
) {
  const now = Date.now()
  const payload = JSON.stringify(
    parsed?.nodes.map((node, position) => ({
      ...node,
      position,
      id: crypto.randomUUID(),
      physicalId: crypto.randomUUID(),
    })) ?? [],
  )
  // D1 的单个字符串上限为 2 MB；超限时在任何正式写入之前结束，不退回非原子分批提交。
  if (new TextEncoder().encode(payload).byteLength > 2_000_000)
    throw new PermanentJobError('解析后的订阅数据超过 D1 的 2 MB 提交上限')
  const count = parsed?.nodes.length ?? source.nodeCount
  if (count > 2000) throw new PermanentJobError('全局节点数量超过 2000')

  // 第一条语句是事务内认领标记。其余语句必须同时匹配该标记、租约和源版本；
  // 不能仅在最后检查版本，否则下载期间的修改仍可能被前面的节点写入覆盖。
  const guard = `EXISTS (SELECT 1 FROM jobs j JOIN sources s ON s.id = ?
    WHERE j.id = ? AND j.status = 'running' AND j.lease_token = ? AND j.refresh_commit_token = ?
    AND s.version = ? AND s.enabled = 1)`
  const guardValues = [source.id, lease.id, lease.token, lease.token, source.version]
  const statements = [
    env.DB.prepare(
      `UPDATE jobs SET refresh_commit_token = ?, source_version = ?
     WHERE id = ? AND lease_token = ? AND status = 'running' AND refresh_commit_token IS NULL
     AND EXISTS (SELECT 1 FROM sources s WHERE s.id = ? AND s.version = ? AND s.enabled = 1
       AND (SELECT count(*) FROM nodes WHERE source_id <> s.id) + ? <= 2000)`,
    ).bind(lease.token, source.version + 1, lease.id, lease.token, source.id, source.version, count),
  ]

  if (parsed) {
    // 在删除旧节点前收集指定节点绑定；任务记录与刷新结果一起提交，防止丢掉编译通知。
    statements.push(
      env.DB.prepare(
        `INSERT INTO jobs (id, type, entity_id, status, created_at, parent_job_id)
       SELECT ? || ':' || affected.id, 'compile_profile', affected.id, 'pending', ?, ?
       FROM (${affectedSourceProfilesSql}) affected JOIN profiles p ON p.id = affected.id
       WHERE ${guard} ON CONFLICT(id) DO NOTHING`,
      ).bind(lease.id, now, lease.id, source.id, source.id, source.id, source.id, source.id, ...guardValues),
    )
    statements.push(
      env.DB.prepare(
        `INSERT INTO physical_nodes (id, fingerprint, protocol, server, port, config, created_at, updated_at)
       SELECT json_extract(value, '$.physicalId'), json_extract(value, '$.fingerprint'),
         json_extract(value, '$.config.type'), json_extract(value, '$.config.server'),
         json_extract(value, '$.config.port'), json_extract(value, '$.config'), ?, ?
       FROM json_each(?) WHERE ${guard} ON CONFLICT(fingerprint) DO NOTHING`,
      ).bind(now, now, payload, ...guardValues),
    )
    statements.push(
      env.DB.prepare(
        `INSERT INTO nodes (id, source_id, physical_node_id, original_name, alias, enabled, position, created_at, updated_at)
       SELECT coalesce(existing.id, json_extract(item.value, '$.id')), ?, physical.id,
         json_extract(item.value, '$.originalName'), NULL, 1, json_extract(item.value, '$.position'), ?, ?
       FROM json_each(?) item JOIN physical_nodes physical ON physical.fingerprint = json_extract(item.value, '$.fingerprint')
       LEFT JOIN nodes existing ON existing.source_id = ? AND existing.physical_node_id = physical.id
       WHERE ${guard}
       ON CONFLICT(id) DO UPDATE SET original_name=excluded.original_name, position=excluded.position, updated_at=excluded.updated_at`,
      ).bind(source.id, now, now, payload, source.id, ...guardValues),
    )
    statements.push(
      env.DB.prepare(
        `DELETE FROM nodes WHERE source_id = ? AND ${guard} AND physical_node_id NOT IN (
        SELECT p.id FROM physical_nodes p JOIN json_each(?) item ON p.fingerprint = json_extract(item.value, '$.fingerprint'))`,
      ).bind(source.id, ...guardValues, payload),
    )
    statements.push(
      env.DB.prepare(
        `DELETE FROM physical_nodes WHERE ${guard} AND NOT EXISTS (SELECT 1 FROM nodes WHERE physical_node_id = physical_nodes.id)`,
      ).bind(...guardValues),
    )
    statements.push(env.DB.prepare(`DELETE FROM tags WHERE ${guard} AND ${orphanTagsSql}`).bind(...guardValues))
  }
  const info = response.subscriptionInfo
  const keepInfo = response.notModified && !info
  statements.push(
    env.DB.prepare(
      `UPDATE sources SET url=?, pending_url=NULL, name=?, status='ready', warning=?, error=NULL,
     node_count=?, etag=?, last_modified=?, upload_bytes=?, download_bytes=?, total_bytes=?, expire_at=?,
     info_refreshed_at=?, last_refreshed_at=?, next_refresh_at=?, updated_at=?, version=version+1
     WHERE id=? AND ${guard}`,
    ).bind(
      source.pendingUrl || source.url,
      response.name ?? source.name,
      parsed ? parsed.warnings.join('\n') || null : source.warning,
      count,
      response.notModified ? source.etag : response.etag,
      response.notModified ? source.lastModified : response.lastModified,
      keepInfo ? source.uploadBytes : (info?.upload ?? null),
      keepInfo ? source.downloadBytes : (info?.download ?? null),
      keepInfo ? source.totalBytes : (info?.total ?? null),
      keepInfo ? source.expireAt : (info?.expire ?? null),
      keepInfo ? (source.infoRefreshedAt?.getTime() ?? null) : info ? now : null,
      now,
      source.refreshIntervalHours > 0 ? now + source.refreshIntervalHours * 3_600_000 : null,
      now,
      source.id,
      ...guardValues,
    ),
  )
  const [claimed] = await env.DB.batch(statements)
  if (!claimed.meta.changes) {
    const current = await db(env).select().from(sources).where(eq(sources.id, source.id)).get()
    if (!current || !current.enabled) throw new PermanentJobError('节点源已删除或停用', false)
    if (current.version !== source.version) throw new Error('节点源已变更，重新获取最新设置')
    const total = await env.DB.prepare('SELECT count(*) AS n FROM nodes WHERE source_id <> ?')
      .bind(source.id)
      .first<{ n: number }>()
    if (Number(total?.n) + count > 2000) throw new PermanentJobError('全局节点数量超过 2000')
    throw new Error('任务执行权已变更')
  }
}

async function tagModeProfileIds(env: Env) {
  const rows = await env.DB.prepare(
    `SELECT profile_id AS id FROM profile_node_binding WHERE mode = 'tag'
     UNION SELECT profile_id AS id FROM profile_slot_bindings WHERE mode = 'tag'`,
  ).all<{ id: string }>()
  return rows.results.map(({ id }) => id)
}

async function sourceModeProfileIds(env: Env, sourceIds: string[]) {
  if (!sourceIds.length) return []
  const [globalRows, slotRows] = await Promise.all([
    db(env)
      .select({ id: profileNodeSources.profileId })
      .from(profileNodeSources)
      .where(inArray(profileNodeSources.sourceId, sourceIds)),
    db(env)
      .select({ id: profileSlotSources.profileId })
      .from(profileSlotSources)
      .where(inArray(profileSlotSources.sourceId, sourceIds)),
  ])
  return [...globalRows, ...slotRows].map(({ id }) => id)
}

export async function affectedProfileIdsForSource(env: Env, sourceId: string) {
  const rows = await env.DB.prepare(affectedSourceProfilesSql)
    .bind(sourceId, sourceId, sourceId, sourceId, sourceId)
    .all<{ id: string }>()
  return rows.results.map(({ id }) => id)
}

export async function enqueueProfileIds(env: Env, profileIds: Iterable<string>) {
  for (const id of new Set(profileIds)) await createJob(env, 'compile_profile', id)
}

export async function enqueueAffectedProfiles(env: Env, sourceId: string) {
  await enqueueProfileIds(env, await affectedProfileIdsForSource(env, sourceId))
}

export async function affectedProfileIdsForNodes(env: Env, nodeIds: string[]) {
  if (!nodeIds.length) return []
  const [globalDirectBound, slotDirectBound, sourceIds, tagBound] = await Promise.all([
    db(env)
      .select({ id: profileNodeNodes.profileId })
      .from(profileNodeNodes)
      .where(sql`${profileNodeNodes.nodeId} IN (SELECT value FROM json_each(${JSON.stringify(nodeIds)}))`),
    db(env)
      .select({ id: profileSlotNodes.profileId })
      .from(profileSlotNodes)
      .where(sql`${profileSlotNodes.nodeId} IN (SELECT value FROM json_each(${JSON.stringify(nodeIds)}))`),
    db(env)
      .selectDistinct({ sourceId: nodes.sourceId })
      .from(nodes)
      .where(sql`${nodes.id} IN (SELECT value FROM json_each(${JSON.stringify(nodeIds)}))`),
    tagModeProfileIds(env),
  ])
  return [
    ...new Set([
      ...globalDirectBound.map(({ id }) => id),
      ...slotDirectBound.map(({ id }) => id),
      ...(await sourceModeProfileIds(
        env,
        sourceIds.map(({ sourceId }) => sourceId),
      )),
      ...tagBound,
    ]),
  ]
}

export async function enqueueProfilesForNode(env: Env, nodeId: string) {
  await enqueueProfileIds(env, await affectedProfileIdsForNodes(env, [nodeId]))
}

export async function enqueueProfilesForNodes(env: Env, nodeIds: string[]) {
  await enqueueProfileIds(env, await affectedProfileIdsForNodes(env, nodeIds))
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

export async function refreshSource(env: Env, sourceId: string, lease: JobLease) {
  const database = db(env)
  const job = await database.select().from(jobs).where(eq(jobs.id, lease.id)).get()
  if (job?.refreshCommitToken) {
    // 刷新已经提交。这里只补发持久化的编译任务，不能重新 fetch 后被 304 短路。
    await dispatchRefreshChildren(env, lease.id)
    return
  }
  const source = await database.select().from(sources).where(eq(sources.id, sourceId)).get()
  if (!source || !source.enabled) throw new PermanentJobError('节点源已删除或停用', false)
  if (source.kind !== 'url') throw new PermanentJobError('系统节点源不能刷新', false)
  await database
    .update(jobs)
    .set({ sourceVersion: source.version })
    .where(and(eq(jobs.id, lease.id), eq(jobs.leaseToken, lease.token)))
  await database
    .update(sources)
    .set({ status: 'refreshing', error: null, updatedAt: new Date() })
    .where(
      and(
        eq(sources.id, sourceId),
        eq(sources.version, source.version),
        sql`EXISTS (SELECT 1 FROM jobs WHERE id = ${lease.id} AND lease_token = ${lease.token})`,
      ),
    )

  const response = await fetchSource(
    source.pendingUrl || source.url!,
    source.userAgent,
    source.pendingUrl ? null : source.etag,
    source.pendingUrl ? null : source.lastModified,
  )
  let parsed: Awaited<ReturnType<typeof parseProxyText>> | null = null
  if (response.notModified) {
    if (source.pendingUrl) throw new PermanentJobError('新订阅地址无法验证')
  } else {
    try {
      parsed = await parseProxyText(response.text, source.nodeNameFilter)
    } catch (error) {
      throw new PermanentJobError(error instanceof Error ? error.message : '订阅内容无效')
    }
  }
  await commitSourceRefresh(env, source, parsed, response, lease)
  await dispatchRefreshChildren(env, lease.id)
}

function nodeNameMatcher({ includeRegex, excludeRegex }: { includeRegex: string | null; excludeRegex: string | null }) {
  let include: RegExp | undefined
  let exclude: RegExp | undefined
  // 首次实际匹配时构造，保留空节点和包含规则短路时不触发无效正则的行为。
  return (name: string) =>
    (!includeRegex || (include ??= new RegExp(includeRegex)).test(name)) &&
    (!excludeRegex || !(exclude ??= new RegExp(excludeRegex)).test(name))
}

export async function selectSourceSlotNodes(
  env: Env,
  profileId: string,
  bindings: Extract<ProfileSlotBinding, { mode: 'source' }>[],
): Promise<SelectedSlotNode[]> {
  if (!bindings.length) return []
  const bySlot = new Map(bindings.map((binding) => [binding.slotKey, nodeNameMatcher(binding)]))
  const selected = await db(env)
    .select({
      slotKey: profileSlotSources.slotKey,
      id: nodes.id,
      physicalNodeId: nodes.physicalNodeId,
      config: physicalNodes.config,
      alias: nodes.alias,
      originalName: nodes.originalName,
    })
    .from(profileSlotSources)
    .innerJoin(nodes, eq(nodes.sourceId, profileSlotSources.sourceId))
    .innerJoin(physicalNodes, eq(physicalNodes.id, nodes.physicalNodeId))
    .innerJoin(sources, eq(sources.id, nodes.sourceId))
    .where(and(eq(profileSlotSources.profileId, profileId), eq(nodes.enabled, true), eq(sources.enabled, true)))
    .orderBy(asc(sources.name), asc(nodes.position), asc(nodes.createdAt))
  return selected.flatMap((node) => {
    const matches = bySlot.get(node.slotKey)
    const name = node.alias || node.originalName
    if (!matches?.(name)) return []
    return [{ slotKey: node.slotKey, nodeId: node.id, physicalNodeId: node.physicalNodeId, config: node.config, name }]
  })
}

export async function selectDirectSlotNodes(
  env: Env,
  bindings: Extract<ProfileSlotBindingInput, { mode: 'node' }>[],
  slotNames: Map<string, string>,
): Promise<SelectedSlotNode[]> {
  const nodeIds = [...new Set(bindings.flatMap((binding) => binding.nodeIds))]
  if (!nodeIds.length) return []
  const rows = await db(env)
    .select({
      id: nodes.id,
      physicalNodeId: nodes.physicalNodeId,
      config: physicalNodes.config,
      alias: nodes.alias,
      originalName: nodes.originalName,
      nodeEnabled: nodes.enabled,
      sourceEnabled: sources.enabled,
    })
    .from(nodes)
    .innerJoin(physicalNodes, eq(physicalNodes.id, nodes.physicalNodeId))
    .innerJoin(sources, eq(sources.id, nodes.sourceId))
    .where(sql`${nodes.id} IN (SELECT value FROM json_each(${JSON.stringify(nodeIds)}))`)
  const byId = new Map(rows.map((node) => [node.id, node]))
  const result: SelectedSlotNode[] = []
  for (const binding of bindings) {
    const unavailable = binding.nodeIds.filter((id) => {
      const node = byId.get(id)
      return !node || !node.nodeEnabled || !node.sourceEnabled
    })
    if (unavailable.length)
      throw new PermanentJobError(
        `槽位“${slotNames.get(binding.slotKey) || binding.slotKey}”包含 ${unavailable.length} 个不可用的指定节点，请重新选择`,
      )
    for (const id of binding.nodeIds) {
      const node = byId.get(id)!
      result.push({
        slotKey: binding.slotKey,
        nodeId: id,
        physicalNodeId: node.physicalNodeId,
        config: node.config,
        name: node.alias || node.originalName,
      })
    }
  }
  return result
}

async function enabledNodes(env: Env) {
  return db(env)
    .select({
      nodeId: nodes.id,
      physicalNodeId: nodes.physicalNodeId,
      config: physicalNodes.config,
      alias: nodes.alias,
      originalName: nodes.originalName,
    })
    .from(nodes)
    .innerJoin(physicalNodes, eq(physicalNodes.id, nodes.physicalNodeId))
    .innerJoin(sources, eq(sources.id, nodes.sourceId))
    .where(and(eq(nodes.enabled, true), eq(sources.enabled, true)))
    .orderBy(asc(sources.name), asc(nodes.position), asc(nodes.createdAt))
}

async function filterNodesByTags<T extends { nodeId: string }>(env: Env, rows: T[], tagNames: string[]) {
  const wanted = new Set(tagNames.map(normalizeTagName))
  const views = await nodeTagViews(
    env,
    rows.map(({ nodeId }) => nodeId),
  )
  return rows.filter(({ nodeId }) => {
    const view = views.get(nodeId) || { direct: [], inherited: [] }
    return mergeTagViews(view.direct, view.inherited).some(({ name }) => wanted.has(normalizeTagName(name)))
  })
}

async function selectTagSlotNodes(
  env: Env,
  bindings: Extract<ProfileSlotBindingInput, { mode: 'tag' }>[],
): Promise<SelectedSlotNode[]> {
  if (!bindings.length) return []
  const rows = await enabledNodes(env)
  const result: SelectedSlotNode[] = []
  for (const binding of bindings) {
    const matches = nodeNameMatcher(binding)
    for (const node of await filterNodesByTags(env, rows, binding.tags)) {
      const name = node.alias || node.originalName
      if (!matches(name)) continue
      result.push({
        slotKey: binding.slotKey,
        nodeId: node.nodeId,
        physicalNodeId: node.physicalNodeId,
        config: node.config,
        name,
      })
    }
  }
  return result
}

async function selectGlobalNodes(env: Env, profileId: string, binding: ProfileNodeBinding): Promise<SelectedNode[]> {
  if (binding.mode === 'source') {
    const rows = await db(env)
      .select({
        nodeId: nodes.id,
        physicalNodeId: nodes.physicalNodeId,
        config: physicalNodes.config,
        alias: nodes.alias,
        originalName: nodes.originalName,
      })
      .from(profileNodeSources)
      .innerJoin(nodes, eq(nodes.sourceId, profileNodeSources.sourceId))
      .innerJoin(physicalNodes, eq(physicalNodes.id, nodes.physicalNodeId))
      .innerJoin(sources, eq(sources.id, nodes.sourceId))
      .where(and(eq(profileNodeSources.profileId, profileId), eq(nodes.enabled, true), eq(sources.enabled, true)))
      .orderBy(asc(sources.name), asc(nodes.position), asc(nodes.createdAt))
    const matches = nodeNameMatcher(binding)
    return rows.flatMap((node) => {
      const name = node.alias || node.originalName
      if (!matches(name)) return []
      return [{ ...node, name }]
    })
  }

  if (binding.mode === 'tag') {
    const rows = await filterNodesByTags(env, await enabledNodes(env), binding.tags)
    const matches = nodeNameMatcher(binding)
    return rows.flatMap((node) => {
      const name = node.alias || node.originalName
      if (!matches(name)) return []
      return [{ ...node, name }]
    })
  }

  const rows = await db(env)
    .select({
      nodeId: nodes.id,
      physicalNodeId: nodes.physicalNodeId,
      config: physicalNodes.config,
      alias: nodes.alias,
      originalName: nodes.originalName,
      nodeEnabled: nodes.enabled,
      sourceEnabled: sources.enabled,
    })
    .from(nodes)
    .innerJoin(physicalNodes, eq(physicalNodes.id, nodes.physicalNodeId))
    .innerJoin(sources, eq(sources.id, nodes.sourceId))
    .where(sql`${nodes.id} IN (SELECT value FROM json_each(${JSON.stringify(binding.nodeIds)}))`)
  const byId = new Map(rows.map((node) => [node.nodeId, node]))
  const unavailable = binding.nodeIds.filter((id) => {
    const node = byId.get(id)
    return !node || !node.nodeEnabled || !node.sourceEnabled
  })
  if (unavailable.length)
    throw new PermanentJobError(`节点选择包含 ${unavailable.length} 个不可用的指定节点，请重新选择`)
  return binding.nodeIds.map((id) => {
    const node = byId.get(id)!
    return { ...node, name: node.alias || node.originalName }
  })
}

export async function selectProfileNodes(
  env: Env,
  profile: typeof profiles.$inferSelect,
  slotNames = new Map<string, string>(),
  providerSlotKeys = new Set<string>(),
): Promise<{ globalNodes: SelectedNode[]; slotNodes: SelectedSlotNode[] }> {
  const [nodeBinding, allBindings] = await Promise.all([
    readProfileNodeBinding(env, profile.id),
    readProfileSlotBindings(env, profile.id),
  ])
  const bindings = allBindings.filter(({ slotKey }) => !providerSlotKeys.has(slotKey))
  const globalNodes = await selectGlobalNodes(env, profile.id, nodeBinding)
  const slotNodes = [
    ...(await selectSourceSlotNodes(
      env,
      profile.id,
      bindings.filter((binding) => binding.mode === 'source'),
    )),
    ...(await selectDirectSlotNodes(
      env,
      bindings.filter((binding) => binding.mode === 'node'),
      slotNames,
    )),
    ...(await selectTagSlotNodes(
      env,
      bindings.filter((binding) => binding.mode === 'tag'),
    )),
  ]
  const selected = [...globalNodes, ...slotNodes]
  const filterTagIds = await profileFilterTagIds(env, profile.id)
  const views = await nodeTagViews(env, [...new Set(selected.map(({ nodeId }) => nodeId))])
  const seen = new Set<string>()
  const filtered = selected.filter((node) => {
    const view = views.get(node.nodeId) || { direct: [], inherited: [] }
    const effectiveTagIds = mergeTagViews(view.direct, view.inherited).map(({ id }) => id)
    const key = `${'slotKey' in node ? node.slotKey : 'global'}:${node.physicalNodeId}`
    if (!matchesAnyTag(effectiveTagIds, filterTagIds) || seen.has(key)) return false
    seen.add(key)
    return true
  })
  return {
    globalNodes: filtered.filter((node): node is SelectedNode => !('slotKey' in node)),
    slotNodes: filtered.filter((node): node is SelectedSlotNode => 'slotKey' in node),
  }
}

async function selectDraftGlobalNodes(env: Env, binding: ProfileNodeBindingInput): Promise<SelectedNode[]> {
  if (binding.mode === 'source') {
    if (!binding.sourceIds.length) return []
    const rows = await db(env)
      .select({
        nodeId: nodes.id,
        physicalNodeId: nodes.physicalNodeId,
        config: physicalNodes.config,
        alias: nodes.alias,
        originalName: nodes.originalName,
      })
      .from(nodes)
      .innerJoin(physicalNodes, eq(physicalNodes.id, nodes.physicalNodeId))
      .innerJoin(sources, eq(sources.id, nodes.sourceId))
      .where(and(inArray(nodes.sourceId, binding.sourceIds), eq(nodes.enabled, true), eq(sources.enabled, true)))
      .orderBy(asc(sources.name), asc(nodes.position), asc(nodes.createdAt))
    const matches = nodeNameMatcher(binding)
    return rows.flatMap((node) => {
      const name = node.alias || node.originalName
      if (!matches(name)) return []
      return [{ ...node, name }]
    })
  }

  if (binding.mode === 'tag') {
    const rows = await filterNodesByTags(env, await enabledNodes(env), binding.tags)
    const matches = nodeNameMatcher(binding)
    return rows.flatMap((node) => {
      const name = node.alias || node.originalName
      if (!matches(name)) return []
      return [{ ...node, name }]
    })
  }

  if (!binding.nodeIds.length) return []
  const rows = await db(env)
    .select({
      nodeId: nodes.id,
      physicalNodeId: nodes.physicalNodeId,
      config: physicalNodes.config,
      alias: nodes.alias,
      originalName: nodes.originalName,
      nodeEnabled: nodes.enabled,
      sourceEnabled: sources.enabled,
    })
    .from(nodes)
    .innerJoin(physicalNodes, eq(physicalNodes.id, nodes.physicalNodeId))
    .innerJoin(sources, eq(sources.id, nodes.sourceId))
    .where(sql`${nodes.id} IN (SELECT value FROM json_each(${JSON.stringify(binding.nodeIds)}))`)
  const byId = new Map(rows.map((node) => [node.nodeId, node]))
  const unavailable = binding.nodeIds.filter((id) => {
    const node = byId.get(id)
    return !node || !node.nodeEnabled || !node.sourceEnabled
  })
  if (unavailable.length)
    throw new PermanentJobError(`节点选择包含 ${unavailable.length} 个不可用的指定节点，请重新选择`)
  return binding.nodeIds.map((id) => {
    const node = byId.get(id)!
    return { ...node, name: node.alias || node.originalName }
  })
}

async function selectDraftSourceSlotNodes(
  env: Env,
  bindings: Extract<ProfileSlotBindingInput, { mode: 'source' }>[],
): Promise<SelectedSlotNode[]> {
  if (!bindings.length) return []
  const allSourceIds = [...new Set(bindings.flatMap((b) => b.sourceIds))]
  if (!allSourceIds.length) return []
  const rows = await db(env)
    .select({
      id: nodes.id,
      sourceId: nodes.sourceId,
      physicalNodeId: nodes.physicalNodeId,
      config: physicalNodes.config,
      alias: nodes.alias,
      originalName: nodes.originalName,
    })
    .from(nodes)
    .innerJoin(physicalNodes, eq(physicalNodes.id, nodes.physicalNodeId))
    .innerJoin(sources, eq(sources.id, nodes.sourceId))
    .where(and(inArray(nodes.sourceId, allSourceIds), eq(nodes.enabled, true), eq(sources.enabled, true)))
    .orderBy(asc(sources.name), asc(nodes.position), asc(nodes.createdAt))

  const result: SelectedSlotNode[] = []
  for (const binding of bindings) {
    const sourceSet = new Set(binding.sourceIds)
    const slotNodes = rows.filter((node) => sourceSet.has(node.sourceId))
    const matches = nodeNameMatcher(binding)
    for (const node of slotNodes) {
      const name = node.alias || node.originalName
      if (!matches(name)) continue
      result.push({
        slotKey: binding.slotKey,
        nodeId: node.id,
        physicalNodeId: node.physicalNodeId,
        config: node.config,
        name,
      })
    }
  }
  return result
}

export async function selectDraftProfileNodes(
  env: Env,
  draft: {
    nodeBinding: ProfileNodeBindingInput
    slotBindings: ProfileSlotBindingInput[]
    tags?: string[]
  },
  slotNames = new Map<string, string>(),
  providerSlotKeys = new Set<string>(),
): Promise<{ globalNodes: SelectedNode[]; slotNodes: SelectedSlotNode[] }> {
  const bindings = draft.slotBindings.filter(({ slotKey }) => !providerSlotKeys.has(slotKey))
  const globalNodes = await selectDraftGlobalNodes(env, draft.nodeBinding)
  const slotNodes = [
    ...(await selectDraftSourceSlotNodes(
      env,
      bindings.filter((b): b is Extract<ProfileSlotBindingInput, { mode: 'source' }> => b.mode === 'source'),
    )),
    ...(await selectDirectSlotNodes(
      env,
      bindings.filter((b): b is Extract<ProfileSlotBindingInput, { mode: 'node' }> => b.mode === 'node'),
      slotNames,
    )),
    ...(await selectTagSlotNodes(
      env,
      bindings.filter((b): b is Extract<ProfileSlotBindingInput, { mode: 'tag' }> => b.mode === 'tag'),
    )),
  ]

  const selected = [...globalNodes, ...slotNodes]
  const filterTags = draft.tags || []
  let filterTagIds: string[] = []
  if (filterTags.length > 0) {
    const normalized = filterTags.map(normalizeTagName)
    const rows = await env.DB.prepare(
      `SELECT id FROM tags WHERE normalized_name IN (${normalized.map(() => '?').join(',')})`,
    )
      .bind(...normalized)
      .all<{ id: string }>()
    filterTagIds = rows.results.length ? rows.results.map((r) => r.id) : ['__nonexistent_tag__']
  }

  const views = await nodeTagViews(env, [...new Set(selected.map(({ nodeId }) => nodeId))])
  const seen = new Set<string>()
  const filtered = selected.filter((node) => {
    const view = views.get(node.nodeId) || { direct: [], inherited: [] }
    const effectiveTagIds = mergeTagViews(view.direct, view.inherited).map(({ id }) => id)
    const key = `${'slotKey' in node ? node.slotKey : 'global'}:${node.physicalNodeId}`
    if (!matchesAnyTag(effectiveTagIds, filterTagIds) || seen.has(key)) return false
    seen.add(key)
    return true
  })

  return {
    globalNodes: filtered.filter((node): node is SelectedNode => !('slotKey' in node)),
    slotNodes: filtered.filter((node): node is SelectedSlotNode => 'slotKey' in node),
  }
}

export async function compileProfile(env: Env, profileId: string, lease?: JobLease) {
  const database = db(env)
  const profile = await database.select().from(profiles).where(eq(profiles.id, profileId)).get()
  if (!profile) throw new PermanentJobError('配置不存在', false)
  const template = await resolveTemplate(env, profile.templateId)
  if (!template) throw new PermanentJobError('订阅模板不存在')

  const slotNames = new Map(template.sourceSlots.map(({ key, name }) => [key, name]))
  const providerSlotKeys = new Set(
    template.sourceSlots.filter(({ type }) => type === 'subscription').map(({ key }) => key),
  )
  const selected = await selectProfileNodes(env, profile, slotNames, providerSlotKeys)
  let yaml: string
  try {
    const [bindings, subscriptionSourceIds] = await Promise.all([
      readProfileSlotBindings(env, profile.id),
      readProfileSubscriptionSources(env, profile.id),
    ])
    const proxyProviders = await resolveProfileProxyProviders(
      env,
      template.sourceSlots,
      bindings,
      subscriptionSourceIds,
    )
    yaml = renderMihomoConfig({ ...selected, template, proxyProviders })
  } catch (error) {
    throw new PermanentJobError(error instanceof Error ? error.message : '配置生成失败')
  }
  const now = new Date()
  if (lease) {
    // 编译结果与任务终态一并提交：不能在 YAML 已写入但任务终态失败后再次增加 revision。
    const [updated] = await env.DB.batch([
      env.DB.prepare(`UPDATE profiles SET revision=revision+1, compiled_yaml=?, compiled_at=?, error=NULL, updated_at=?
        WHERE id=? AND revision=? AND updated_at=? AND EXISTS (
          SELECT 1 FROM jobs WHERE id=? AND lease_token=? AND status='running')`).bind(
        yaml,
        now.getTime(),
        now.getTime(),
        profileId,
        profile.revision,
        profile.updatedAt.getTime(),
        lease.id,
        lease.token,
      ),
      env.DB.prepare(`UPDATE jobs SET status='succeeded', error=NULL, finished_at=?, lease_token=NULL, lease_until=NULL
        WHERE id=? AND lease_token=? AND status='running' AND changes()=1`).bind(now.getTime(), lease.id, lease.token),
    ])
    if (!updated.meta.changes) throw new Error('配置或任务执行权已变更，重新编译')
  } else {
    const updated = await database
      .update(profiles)
      .set({ revision: profile.revision + 1, compiledYaml: yaml, compiledAt: now, error: null, updatedAt: now })
      .where(
        and(
          eq(profiles.id, profileId),
          eq(profiles.revision, profile.revision),
          eq(profiles.updatedAt, profile.updatedAt),
        ),
      )
      .returning({ id: profiles.id })
    if (!updated.length) throw new Error('配置已变更，重新编译')
  }
}

async function finishJob(env: Env, job: typeof jobs.$inferSelect, lease: JobLease, error?: Error) {
  const now = Date.now()
  const text = error?.message ?? null
  const statements: D1PreparedStatement[] = []
  const owned = `EXISTS (SELECT 1 FROM jobs j WHERE j.id = ? AND j.lease_token = ? AND j.status = 'running')`
  if (error && (!(error instanceof PermanentJobError) || error.affectsEntity)) {
    if (job.type === 'refresh_source') {
      statements.push(
        env.DB.prepare(
          `UPDATE sources SET status='error', error=?, updated_at=?,
          next_refresh_at=CASE WHEN enabled=1 AND refresh_interval_hours>0 THEN ? + refresh_interval_hours * 3600000 ELSE NULL END
          WHERE id=? AND EXISTS (
          SELECT 1 FROM jobs j WHERE j.id=? AND j.lease_token=? AND j.status='running'
          AND j.refresh_commit_token IS NULL AND j.source_version=sources.version)`,
        ).bind(text, now, now, job.entityId, lease.id, lease.token),
      )
    } else {
      statements.push(
        env.DB.prepare(`UPDATE profiles SET error=?, updated_at=? WHERE id=? AND updated_at <= ? AND ${owned}`).bind(
          text,
          now,
          job.entityId,
          job.startedAt!.getTime(),
          lease.id,
          lease.token,
        ),
      )
    }
  }
  statements.push(
    env.DB.prepare(
      `UPDATE jobs SET status=?, error=?, finished_at=?, lease_token=NULL, lease_until=NULL
     WHERE id=? AND lease_token=? AND status='running'`,
    ).bind(error ? 'failed' : 'succeeded', text, now, lease.id, lease.token),
  )
  await env.DB.batch(statements)
}

// 返回延迟表示需要 Queue.retry；undefined 才能 ack。数据库写入失败会抛出，不能伪装成成功。
export async function processQueueMessage(env: Env, message: QueueMessage): Promise<number | undefined> {
  const database = db(env)
  const previous = await database.select().from(jobs).where(eq(jobs.id, message.jobId)).get()
  if (!previous || previous.status === 'succeeded' || previous.status === 'failed') return
  const now = Date.now()
  const lease = { id: previous.id, token: crypto.randomUUID() }
  const job = await database
    .update(jobs)
    .set({
      status: 'running',
      leaseToken: lease.token,
      leaseUntil: new Date(now + JOB_LEASE_MS),
      attempts: Math.min(previous.attempts + 1, MAX_JOB_ATTEMPTS),
      startedAt: new Date(now),
      error: null,
      finishedAt: null,
    })
    .where(
      and(
        eq(jobs.id, previous.id),
        eq(jobs.attempts, previous.attempts),
        sql`${jobs.status} IN ('pending', 'running')`,
        sql`coalesce(${jobs.leaseUntil}, CASE WHEN ${jobs.status}='running' THEN ${jobs.startedAt} + ${JOB_LEASE_MS} END, 0) <= ${now}`,
        sql`NOT EXISTS (SELECT 1 FROM jobs active WHERE active.type=${previous.type} AND active.entity_id=${previous.entityId}
      AND active.id<>${previous.id} AND active.status='running' AND coalesce(active.lease_until, active.started_at + ${JOB_LEASE_MS}, 0)>${now})`,
      ),
    )
    .returning()
    .get()
  if (!job) return 30 // 重复投递或同一实体正在执行，不消耗数据库中的业务尝试次数。
  if (previous.attempts >= MAX_JOB_ATTEMPTS) {
    await finishJob(env, job, lease, new Error('任务执行中断，已达到重试上限'))
    return
  }
  try {
    // 以数据库中的任务类型/目标为准，不信任重复或过期消息携带的其他字段。
    if (job.type === 'refresh_source') {
      await refreshSource(env, job.entityId, lease)
      await finishJob(env, job, lease)
    } else {
      await compileProfile(env, job.entityId, lease)
    }
  } catch (reason) {
    const error = reason instanceof Error ? reason : new Error('任务执行失败')
    if (error instanceof PermanentJobError || error instanceof SyntaxError || job.attempts >= MAX_JOB_ATTEMPTS) {
      await finishJob(env, job, lease, error)
      return
    }
    const delay = Math.min(5 * 2 ** (job.attempts - 1), 60)
    await database
      .update(jobs)
      .set({
        status: 'pending',
        error: error.message,
        leaseToken: null,
        leaseUntil: new Date(Date.now() + delay * 1000),
      })
      .where(and(eq(jobs.id, job.id), eq(jobs.leaseToken, lease.token)))
    return delay
  }
}

export async function recoverJobs(env: Env, now = new Date()) {
  const pending = await db(env)
    .select()
    .from(jobs)
    .where(
      and(
        sql`${jobs.status} IN ('pending', 'running')`,
        sql`coalesce(${jobs.leaseUntil}, CASE WHEN ${jobs.status}='running' THEN ${jobs.startedAt} + ${JOB_LEASE_MS} END, 0) <= ${now.getTime()}`,
        sql`(${jobs.dispatchedAt} IS NULL OR ${jobs.dispatchedAt} <= ${now.getTime() - RECOVERY_SEND_MS})`,
      ),
    )
    .orderBy(asc(jobs.createdAt))
    .limit(20)
  for (const job of pending) {
    try {
      await dispatchJob(env, job)
    } catch (error) {
      console.error('任务恢复入队失败', job.id, error)
    }
  }
}

export async function enqueueDueSources(env: Env, now = new Date()) {
  const database = db(env)
  const due = await database
    .select({ id: sources.id })
    .from(sources)
    .where(
      and(
        eq(sources.kind, 'url'),
        eq(sources.enabled, true),
        gt(sources.refreshIntervalHours, 0),
        lte(
          sql`coalesce(${sources.nextRefreshAt}, coalesce(${sources.lastRefreshedAt}, ${sources.createdAt}) + ${sources.refreshIntervalHours} * 3600000)`,
          now.getTime(),
        ),
      ),
    )
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
