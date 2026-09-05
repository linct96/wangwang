import { and, asc, eq, inArray, lte, or, sql } from 'drizzle-orm'
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
  const [sourceBound, globalDirectBound, slotDirectBound, tagBound] = await Promise.all([
    sourceModeProfileIds(env, [sourceId]),
    db(env)
      .select({ id: profileNodeNodes.profileId })
      .from(profileNodeNodes)
      .innerJoin(nodes, eq(nodes.id, profileNodeNodes.nodeId))
      .where(eq(nodes.sourceId, sourceId)),
    db(env)
      .select({ id: profileSlotNodes.profileId })
      .from(profileSlotNodes)
      .innerJoin(nodes, eq(nodes.id, profileSlotNodes.nodeId))
      .where(eq(nodes.sourceId, sourceId)),
    tagModeProfileIds(env),
  ])
  return [
    ...new Set([
      ...sourceBound,
      ...globalDirectBound.map(({ id }) => id),
      ...slotDirectBound.map(({ id }) => id),
      ...tagBound,
    ]),
  ]
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
  const affectedProfileIds = await affectedProfileIdsForSource(env, sourceId)
  await replaceSourceNodes(env, sourceId, parsed, response)
  await enqueueProfileIds(env, affectedProfileIds)
}

export async function selectSourceSlotNodes(
  env: Env,
  profileId: string,
  bindings: Extract<ProfileSlotBinding, { mode: 'source' }>[],
): Promise<SelectedSlotNode[]> {
  if (!bindings.length) return []
  const bySlot = new Map(bindings.map((binding) => [binding.slotKey, binding]))
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
    .orderBy(asc(nodes.position), asc(nodes.createdAt))
  return selected.flatMap((node) => {
    const binding = bySlot.get(node.slotKey)
    const name = node.alias || node.originalName
    if (!binding) return []
    if (binding.includeRegex && !new RegExp(binding.includeRegex).test(name)) return []
    if (binding.excludeRegex && new RegExp(binding.excludeRegex).test(name)) return []
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
      throw new Error(
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
    .orderBy(asc(nodes.position), asc(nodes.createdAt))
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
  for (const binding of bindings)
    for (const node of await filterNodesByTags(env, rows, binding.tags)) {
      const name = node.alias || node.originalName
      if (binding.includeRegex && !new RegExp(binding.includeRegex).test(name)) continue
      if (binding.excludeRegex && new RegExp(binding.excludeRegex).test(name)) continue
      result.push({
        slotKey: binding.slotKey,
        nodeId: node.nodeId,
        physicalNodeId: node.physicalNodeId,
        config: node.config,
        name,
      })
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
      .orderBy(asc(nodes.position), asc(nodes.createdAt))
    return rows.flatMap((node) => {
      const name = node.alias || node.originalName
      if (binding.includeRegex && !new RegExp(binding.includeRegex).test(name)) return []
      if (binding.excludeRegex && new RegExp(binding.excludeRegex).test(name)) return []
      return [{ ...node, name }]
    })
  }

  if (binding.mode === 'tag') {
    const rows = await filterNodesByTags(env, await enabledNodes(env), binding.tags)
    return rows.flatMap((node) => {
      const name = node.alias || node.originalName
      if (binding.includeRegex && !new RegExp(binding.includeRegex).test(name)) return []
      if (binding.excludeRegex && new RegExp(binding.excludeRegex).test(name)) return []
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
  if (unavailable.length) throw new Error(`节点选择包含 ${unavailable.length} 个不可用的指定节点，请重新选择`)
  return binding.nodeIds.map((id) => {
    const node = byId.get(id)!
    return { ...node, name: node.alias || node.originalName }
  })
}

export async function selectProfileNodes(
  env: Env,
  profile: typeof profiles.$inferSelect,
  slotNames = new Map<string, string>(),
): Promise<{ globalNodes: SelectedNode[]; slotNodes: SelectedSlotNode[] }> {
  const [nodeBinding, bindings] = await Promise.all([
    readProfileNodeBinding(env, profile.id),
    readProfileSlotBindings(env, profile.id),
  ])
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
      .orderBy(asc(nodes.position), asc(nodes.createdAt))
    return rows.flatMap((node) => {
      const name = node.alias || node.originalName
      if (binding.includeRegex && !new RegExp(binding.includeRegex).test(name)) return []
      if (binding.excludeRegex && new RegExp(binding.excludeRegex).test(name)) return []
      return [{ ...node, name }]
    })
  }

  if (binding.mode === 'tag') {
    const rows = await filterNodesByTags(env, await enabledNodes(env), binding.tags)
    return rows.flatMap((node) => {
      const name = node.alias || node.originalName
      if (binding.includeRegex && !new RegExp(binding.includeRegex).test(name)) return []
      if (binding.excludeRegex && new RegExp(binding.excludeRegex).test(name)) return []
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
  if (unavailable.length) throw new Error(`节点选择包含 ${unavailable.length} 个不可用的指定节点，请重新选择`)
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
    .orderBy(asc(nodes.position), asc(nodes.createdAt))

  const result: SelectedSlotNode[] = []
  for (const binding of bindings) {
    const sourceSet = new Set(binding.sourceIds)
    const slotNodes = rows.filter((node) => sourceSet.has(node.sourceId))
    for (const node of slotNodes) {
      const name = node.alias || node.originalName
      if (binding.includeRegex && !new RegExp(binding.includeRegex).test(name)) continue
      if (binding.excludeRegex && new RegExp(binding.excludeRegex).test(name)) continue
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
): Promise<{ globalNodes: SelectedNode[]; slotNodes: SelectedSlotNode[] }> {
  const globalNodes = await selectDraftGlobalNodes(env, draft.nodeBinding)
  const slotNodes = [
    ...(await selectDraftSourceSlotNodes(
      env,
      draft.slotBindings.filter((b): b is Extract<ProfileSlotBindingInput, { mode: 'source' }> => b.mode === 'source'),
    )),
    ...(await selectDirectSlotNodes(
      env,
      draft.slotBindings.filter((b): b is Extract<ProfileSlotBindingInput, { mode: 'node' }> => b.mode === 'node'),
      slotNames,
    )),
    ...(await selectTagSlotNodes(
      env,
      draft.slotBindings.filter((b): b is Extract<ProfileSlotBindingInput, { mode: 'tag' }> => b.mode === 'tag'),
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

export async function compileProfile(env: Env, profileId: string) {
  const database = db(env)
  const profile = await database.select().from(profiles).where(eq(profiles.id, profileId)).get()
  if (!profile) throw new Error('配置不存在')
  const template = await resolveTemplate(env, profile.templateId)
  if (!template) throw new Error('订阅模板不存在')

  const slotNames = new Map(template.sourceSlots.map(({ key, name }) => [key, name]))
  const yaml = renderMihomoConfig({ ...(await selectProfileNodes(env, profile, slotNames)), template })
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
