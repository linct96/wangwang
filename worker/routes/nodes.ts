import { Hono } from 'hono'
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm'
import { body, fail, ok } from '../http'
import { nodeEntries, nodes, profileSourceBindings, sourceEntries } from '../db'
import type { ProxyConfig } from '../db'
import {
  editableProxyYaml,
  fingerprint,
  parseEditableProxyYaml,
  parseProxyText,
  proxyConfigError,
  restoreProxySecrets,
  shareUri,
} from '../proxy/index'
import {
  cleanupOrphanNodes,
  db,
  enqueueAffectedProfiles,
  enqueueProfilesForEntry,
  enqueueProfilesForEntries,
} from '../tasks'
import {
  buildManualConfig,
  connectionView,
  management,
  MANUAL_SOURCE_ID,
  nodeBatchSchema,
  nodeCreateSchema,
  nodeDeleteBatchSchema,
  nodeImportSchema,
  nodeKinds,
  nodeUpdateSchema,
  preferredNodeCreateSchema,
} from '../node-config'
import { mergeTagViews, normalizeTagInputs } from '../tag-model'
import { entryTagViews, replaceEntryDirectTags, replaceEntryDirectTagsForEntries } from '../tag-store'
import type { PreferredEndpoint } from '../../shared/preferred-node'

export const nodesRouter = new Hono<{ Bindings: Env }>()
const importProtocols = new Set(['ss', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic', 'anytls'])

async function ensurePhysicalNode(env: Env, config: ProxyConfig, nodeFingerprint: string, now: number) {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    `INSERT INTO nodes (id, fingerprint, protocol, server, port, config, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(fingerprint) DO NOTHING`,
  )
    .bind(id, nodeFingerprint, config.type, config.server, config.port, JSON.stringify(config), now, now)
    .run()
  const row = await env.DB.prepare('SELECT id FROM nodes WHERE fingerprint = ?')
    .bind(nodeFingerprint)
    .first<{ id: string }>()
  if (!row) throw new Error('节点保存失败')
  return row.id
}

async function entryView(env: Env, entryId: string) {
  const row = await db(env)
    .select({
      id: nodeEntries.id,
      name: nodeEntries.name,
      alias: nodeEntries.alias,
      enabled: nodeEntries.enabled,
      updatedAt: nodeEntries.updatedAt,
      createdAt: nodeEntries.createdAt,
      fingerprint: nodes.fingerprint,
      protocol: nodes.protocol,
      server: nodes.server,
      port: nodes.port,
      config: nodes.config,
    })
    .from(nodeEntries)
    .innerJoin(nodes, eq(nodes.id, nodeEntries.nodeId))
    .where(eq(nodeEntries.id, entryId))
    .get()
  if (!row) return null
  const [kinds, tagViews] = await Promise.all([nodeKinds(env, [entryId]), entryTagViews(env, [entryId])])
  const nodeManagement = management(kinds.get(entryId) || [])
  const view = tagViews.get(entryId) || { direct: [], inherited: [] }
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    name: row.alias || row.name,
    alias: row.alias,
    protocol: row.protocol,
    server: row.server,
    port: row.port,
    url: shareUri({ ...row.config, name: row.alias || row.name }, row.alias || row.name),
    ...entryTagPayload(view),
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    management: nodeManagement,
    canEditConnection: nodeManagement === 'manual',
    canDelete: nodeManagement === 'manual' || nodeManagement === 'mixed',
  }
}

async function updateSourceEntryCount(env: Env, sourceId: string, now: number) {
  await env.DB.prepare(
    'UPDATE sources SET node_count = (SELECT count(*) FROM source_entries WHERE source_id = ?), updated_at = ? WHERE id = ?',
  )
    .bind(sourceId, now, sourceId)
    .run()
}

async function runBatches(env: Env, statements: D1PreparedStatement[]) {
  for (let index = 0; index < statements.length; index += 80) await env.DB.batch(statements.slice(index, index + 80))
}

function entryTagPayload(view: {
  direct: Array<{ id: string; name: string }>
  inherited: Array<{ id: string; name: string }>
}) {
  return {
    tags: mergeTagViews(view.direct, view.inherited).map((tag) => tag.name),
    directTags: view.direct,
    inheritedTags: view.inherited,
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function preferredConfig(source: ProxyConfig, sourceName: string, endpoint: PreferredEndpoint) {
  const config = structuredClone(source)
  const originalServer = source.server
  if (['hysteria2', 'tuic', 'anytls'].includes(config.type) && !config.sni) config.sni = originalServer
  else if (config.tls && !config.servername && !config.sni) config.servername = originalServer
  if (config.network === 'ws' || config['ws-opts']) {
    const options = { ...record(config['ws-opts']) }
    const headers = { ...record(options.headers) }
    if (!Object.keys(headers).some((key) => key.toLowerCase() === 'host')) headers.Host = originalServer
    config['ws-opts'] = { ...options, headers }
  }
  const suffix = ` | ${endpoint.name}`
  config.name = suffix.length < 80 ? `${sourceName.slice(0, 80 - suffix.length)}${suffix}` : endpoint.name.slice(0, 80)
  config.server = endpoint.server
  if (endpoint.port !== undefined) config.port = endpoint.port
  return config
}

nodesRouter.post('/', async (c) => {
  const input = await body(c, nodeCreateSchema)
  const database = db(c.env)
  const [{ value }] = await database.select({ value: count() }).from(nodeEntries)
  if (Number(value) >= 2000) return fail(c, 409, 'NODE_LIMIT', '全局节点数量已达到 2000 个')

  const config = buildManualConfig(input.connection)
  const nodeFingerprint = await fingerprint(config)
  const directTagNames = normalizeTagInputs(input.tags, 10)
  const now = Date.now()
  const nodeId = await ensurePhysicalNode(c.env, config, nodeFingerprint, now)
  const id = crypto.randomUUID()
  const position = await c.env.DB.prepare(
    'SELECT coalesce(max(position), -1) + 1 AS position FROM source_entries WHERE source_id = ?',
  )
    .bind(MANUAL_SOURCE_ID)
    .first<{ position: number }>()
  const positionValue = Number(position?.position || 0)
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO node_entries (id, node_id, name, alias, enabled, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?)`,
    ).bind(id, nodeId, config.name, input.enabled ? 1 : 0, now, now),
    c.env.DB.prepare(
      `INSERT INTO source_entries (source_id, entry_id, source_key, original_name, position)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(MANUAL_SOURCE_ID, id, id, config.name, positionValue),
  ])
  await replaceEntryDirectTags(c.env, id, directTagNames)
  await updateSourceEntryCount(c.env, MANUAL_SOURCE_ID, now)
  await enqueueAffectedProfiles(c.env, MANUAL_SOURCE_ID)
  const node = await entryView(c.env, id)
  return c.json({ data: { node } }, 201)
})

nodesRouter.post('/import', async (c) => {
  const input = await body(c, nodeImportSchema)
  const database = db(c.env)

  let parsed: Awaited<ReturnType<typeof parseProxyText>>
  try {
    parsed = await parseProxyText(input.content)
  } catch (reason) {
    return fail(c, 422, 'NODE_IMPORT_INVALID', reason instanceof Error ? reason.message : '节点内容无效')
  }
  const supported = parsed.nodes.filter(
    (node) => importProtocols.has(node.config.type) && !proxyConfigError(node.config),
  )
  const rejectedWarnings = parsed.nodes.flatMap((node) => {
    if (!importProtocols.has(node.config.type)) return [`${node.config.name}：不支持 ${node.config.type} 协议`]
    const error = proxyConfigError(node.config)
    return error ? [`${node.config.name}：${error}`] : []
  })
  const warnings = [...parsed.warnings, ...rejectedWarnings.slice(0, Math.max(0, 20 - parsed.warnings.length))]
  const [{ value }] = await database.select({ value: count() }).from(nodeEntries)
  if (Number(value) + supported.length > 2000)
    return fail(c, 409, 'NODE_LIMIT', `最多还能导入 ${Math.max(0, 2000 - Number(value))} 个节点`)
  if (supported.length) {
    const directTagNames = normalizeTagInputs(input.tags, 10)
    const now = Date.now()
    const position = await c.env.DB.prepare(
      'SELECT coalesce(max(position), -1) + 1 AS position FROM source_entries WHERE source_id = ?',
    )
      .bind(MANUAL_SOURCE_ID)
      .first<{ position: number }>()
    const statements: D1PreparedStatement[] = []
    const fingerprints = new Set<string>()
    for (const node of supported) {
      if (fingerprints.has(node.fingerprint)) continue
      fingerprints.add(node.fingerprint)
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO nodes (id, fingerprint, protocol, server, port, config, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(fingerprint) DO NOTHING`,
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
      )
    }
    await runBatches(c.env, statements)
    const physical = await database
      .select({ id: nodes.id, fingerprint: nodes.fingerprint })
      .from(nodes)
      .where(inArray(nodes.fingerprint, [...fingerprints]))
    const physicalByFingerprint = new Map(physical.map((node) => [node.fingerprint, node.id]))
    const entryIds: string[] = []
    const entryStatements: D1PreparedStatement[] = []
    supported.forEach((node, index) => {
      const nodeId = physicalByFingerprint.get(node.fingerprint)
      if (!nodeId) return
      const entryId = crypto.randomUUID()
      entryIds.push(entryId)
      entryStatements.push(
        c.env.DB.prepare(
          `INSERT INTO node_entries (id, node_id, name, alias, enabled, created_at, updated_at)
           VALUES (?, ?, ?, NULL, ?, ?, ?)`,
        ).bind(entryId, nodeId, node.config.name, input.enabled ? 1 : 0, now, now),
        c.env.DB.prepare(
          `INSERT INTO source_entries (source_id, entry_id, source_key, original_name, position)
           VALUES (?, ?, ?, ?, ?)`,
        ).bind(MANUAL_SOURCE_ID, entryId, entryId, node.config.name, Number(position?.position || 0) + index),
      )
    })
    entryStatements.push(
      c.env.DB.prepare(
        'UPDATE sources SET node_count = (SELECT count(*) FROM source_entries WHERE source_id = ?), updated_at = ? WHERE id = ?',
      ).bind(MANUAL_SOURCE_ID, now, MANUAL_SOURCE_ID),
    )
    await runBatches(c.env, entryStatements)
    await replaceEntryDirectTagsForEntries(c.env, entryIds, directTagNames)
    await enqueueAffectedProfiles(c.env, MANUAL_SOURCE_ID)
  }

  return ok(c, {
    created: supported.length,
    skipped: parsed.nodes.length - supported.length,
    warnings,
  })
})

nodesRouter.post('/preferred', async (c) => {
  const input = await body(c, preferredNodeCreateSchema)
  const database = db(c.env)
  const sourceEntryIds = [...new Set(input.sourceEntryIds)]
  const sourceRows = await database
    .select({ id: nodeEntries.id, name: nodeEntries.name, alias: nodeEntries.alias, config: nodes.config })
    .from(nodeEntries)
    .innerJoin(nodes, eq(nodes.id, nodeEntries.nodeId))
    .where(inArray(nodeEntries.id, sourceEntryIds))
  const sourcesById = new Map(sourceRows.map((node) => [node.id, node]))
  const warnings = sourceEntryIds
    .filter((id) => !sourcesById.has(id))
    .map((id) => `节点 ${id} 不存在`)
    .slice(0, 20)
  const candidates = new Map<string, { config: ProxyConfig; fingerprint: string }>()

  for (const sourceEntryId of sourceEntryIds) {
    const source = sourcesById.get(sourceEntryId)
    if (!source) continue
    for (const endpoint of input.addresses) {
      const config = preferredConfig(source.config, source.alias || source.name, endpoint)
      const configError = proxyConfigError(config)
      if (configError) {
        if (warnings.length < 20) warnings.push(`${config.name}：${configError}`)
        continue
      }
      const nodeFingerprint = await fingerprint(config)
      candidates.set(nodeFingerprint, { config, fingerprint: nodeFingerprint })
    }
  }

  const [{ value }] = await database.select({ value: count() }).from(nodeEntries)
  const created = [...candidates.values()]
  if (Number(value) + created.length > 2000)
    return fail(c, 409, 'NODE_LIMIT', `最多还能生成 ${Math.max(0, 2000 - Number(value))} 个节点`)

  if (created.length) {
    const directTagNames = normalizeTagInputs(input.tags, 10)
    const now = Date.now()
    const position = await c.env.DB.prepare(
      'SELECT coalesce(max(position), -1) + 1 AS position FROM source_entries WHERE source_id = ?',
    )
      .bind(MANUAL_SOURCE_ID)
      .first<{ position: number }>()
    const statements: D1PreparedStatement[] = []
    const createdIds: string[] = []
    created.forEach(({ config, fingerprint: nodeFingerprint }, index) => {
      const id = crypto.randomUUID()
      createdIds.push(id)
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO nodes (id, fingerprint, protocol, server, port, config, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(fingerprint) DO NOTHING`,
        ).bind(id, nodeFingerprint, config.type, config.server, config.port, JSON.stringify(config), now, now),
        c.env.DB.prepare(
          `INSERT INTO node_entries (id, node_id, name, alias, enabled, created_at, updated_at)
           SELECT ?, id, ?, NULL, ?, ?, ? FROM nodes WHERE fingerprint = ?`,
        ).bind(id, config.name, input.enabled ? 1 : 0, now, now, nodeFingerprint),
        c.env.DB.prepare(
          `INSERT INTO source_entries (source_id, entry_id, source_key, original_name, position)
           VALUES (?, ?, ?, ?, ?)`,
        ).bind(MANUAL_SOURCE_ID, id, id, config.name, Number(position?.position || 0) + index),
      )
    })
    statements.push(
      c.env.DB.prepare(
        'UPDATE sources SET node_count = (SELECT count(*) FROM source_entries WHERE source_id = ?), updated_at = ? WHERE id = ?',
      ).bind(MANUAL_SOURCE_ID, now, MANUAL_SOURCE_ID),
    )
    await runBatches(c.env, statements)
    await replaceEntryDirectTagsForEntries(c.env, createdIds, directTagNames)
    await enqueueAffectedProfiles(c.env, MANUAL_SOURCE_ID)
  }

  return ok(c, {
    created: created.length,
    skipped: input.sourceEntryIds.length * input.addresses.length - created.length,
    warnings,
  })
})

nodesRouter.get('/', async (c) => {
  const page = Math.max(1, Number(c.req.query('page')) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query('pageSize')) || 50))
  const protocol = c.req.query('protocol')?.trim()
  const enabled = c.req.query('enabled')
  const tagId = c.req.query('tagId')?.trim()
  const query = c.req.query('q')?.trim().slice(0, 100)
  const filters = and(
    protocol ? eq(nodes.protocol, protocol) : undefined,
    enabled === 'true'
      ? eq(nodeEntries.enabled, true)
      : enabled === 'false'
        ? eq(nodeEntries.enabled, false)
        : undefined,
    tagId
      ? sql`(
          EXISTS (SELECT 1 FROM node_entry_tags net WHERE net.entry_id = ${nodeEntries.id} AND net.tag_id = ${tagId})
          OR EXISTS (
            SELECT 1 FROM source_entries se
            JOIN sources s ON s.id = se.source_id
            JOIN source_tags st ON st.source_id = s.id
            WHERE se.entry_id = ${nodeEntries.id} AND s.enabled = 1 AND st.tag_id = ${tagId}
          )
        )`
      : undefined,
    query
      ? sql`instr(lower(coalesce(${nodeEntries.alias}, ${nodeEntries.name}, '') || ' ' || ${nodes.server} || ' ' || ${nodes.protocol}), lower(${query})) > 0`
      : undefined,
    sql`EXISTS (
      SELECT 1 FROM source_entries se
      JOIN sources s ON s.id = se.source_id
      WHERE se.entry_id = ${nodeEntries.id} AND s.enabled = 1
    )`,
  )
  const database = db(c.env)
  const [rows, [{ total }]] = await Promise.all([
    database
      .select({
        id: nodeEntries.id,
        name: nodeEntries.name,
        alias: nodeEntries.alias,
        enabled: nodeEntries.enabled,
        createdAt: nodeEntries.createdAt,
        fingerprint: nodes.fingerprint,
        updatedAt: nodeEntries.updatedAt,
        protocol: nodes.protocol,
        server: nodes.server,
        port: nodes.port,
        config: nodes.config,
      })
      .from(nodeEntries)
      .innerJoin(nodes, eq(nodes.id, nodeEntries.nodeId))
      .where(filters)
      .orderBy(asc(nodes.protocol), asc(nodes.server), asc(nodeEntries.name), asc(nodeEntries.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    database
      .select({ total: count() })
      .from(nodeEntries)
      .innerJoin(nodes, eq(nodes.id, nodeEntries.nodeId))
      .where(filters),
  ])
  const entryIds = rows.map((node) => node.id)
  const [kinds, tagViews] = await Promise.all([nodeKinds(c.env, entryIds), entryTagViews(c.env, entryIds)])
  return ok(c, {
    items: rows.map(({ config, ...node }) => {
      const nodeManagement = management(kinds.get(node.id) || [])
      const view = tagViews.get(node.id) || { direct: [], inherited: [] }
      return {
        ...node,
        name: node.alias || node.name,
        url: shareUri({ ...config, name: node.alias || node.name }, node.alias || node.name),
        ...entryTagPayload(view),
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

nodesRouter.patch('/batch', async (c) => {
  const input = await body(c, nodeBatchSchema)
  const placeholders = input.ids.map(() => '?').join(',')
  await c.env.DB.prepare(`UPDATE node_entries SET enabled = ?, updated_at = ? WHERE id IN (${placeholders})`)
    .bind(input.enabled ? 1 : 0, Date.now(), ...input.ids)
    .run()
  await enqueueProfilesForEntries(c.env, input.ids)
  return ok(c, { updated: input.ids.length })
})

nodesRouter.delete('/batch', async (c) => {
  const input = await body(c, nodeDeleteBatchSchema)
  const kinds = await nodeKinds(c.env, input.ids)
  const manualIds = input.ids.filter((id) => kinds.get(id)?.includes('manual'))
  if (!manualIds.length) return ok(c, { deleted: 0, detached: 0, skipped: input.ids.length })

  const placeholders = manualIds.map(() => '?').join(',')
  const now = Date.now()
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM source_entries WHERE source_id = ? AND entry_id IN (${placeholders})`).bind(
      MANUAL_SOURCE_ID,
      ...manualIds,
    ),
    c.env.DB.prepare(
      `DELETE FROM node_entries WHERE id IN (${placeholders}) AND NOT EXISTS (SELECT 1 FROM source_entries WHERE entry_id = node_entries.id)`,
    ).bind(...manualIds),
    c.env.DB.prepare(
      'UPDATE sources SET node_count = (SELECT count(*) FROM source_entries WHERE source_id = ?), updated_at = ? WHERE id = ?',
    ).bind(MANUAL_SOURCE_ID, now, MANUAL_SOURCE_ID),
  ])
  const remaining = await c.env.DB.prepare(`SELECT id FROM node_entries WHERE id IN (${placeholders})`)
    .bind(...manualIds)
    .all<{ id: string }>()
  await cleanupOrphanNodes(c.env)
  await enqueueAffectedProfiles(c.env, MANUAL_SOURCE_ID)
  return ok(c, {
    deleted: manualIds.length - remaining.results.length,
    detached: remaining.results.length,
    skipped: input.ids.length - manualIds.length,
  })
})

nodesRouter.get('/:id', async (c) => {
  const current = await db(c.env)
    .select({
      id: nodeEntries.id,
      name: nodeEntries.name,
      alias: nodeEntries.alias,
      enabled: nodeEntries.enabled,
      updatedAt: nodeEntries.updatedAt,
      fingerprint: nodes.fingerprint,
      protocol: nodes.protocol,
      server: nodes.server,
      port: nodes.port,
      config: nodes.config,
    })
    .from(nodeEntries)
    .innerJoin(nodes, eq(nodes.id, nodeEntries.nodeId))
    .where(eq(nodeEntries.id, c.req.param('id')))
    .get()
  if (!current) return fail(c, 404, 'NODE_NOT_FOUND', '节点不存在')
  const [kinds, tagViews] = await Promise.all([nodeKinds(c.env, [current.id]), entryTagViews(c.env, [current.id])])
  const nodeManagement = management(kinds.get(current.id) || [])
  const view = tagViews.get(current.id) || { direct: [], inherited: [] }
  const { config, ...safe } = current
  const entryConfig = { ...config, name: safe.name }
  return ok(c, {
    ...safe,
    name: safe.alias || safe.name,
    url: shareUri({ ...entryConfig, name: safe.alias || safe.name }, safe.alias || safe.name),
    ...entryTagPayload(view),
    management: nodeManagement,
    canEditConnection: nodeManagement === 'manual',
    canDelete: nodeManagement === 'manual' || nodeManagement === 'mixed',
    connection: nodeManagement === 'manual' ? connectionView(entryConfig) : null,
    yaml: nodeManagement === 'manual' ? editableProxyYaml(entryConfig) : null,
  })
})

nodesRouter.patch('/:id', async (c) => {
  const input = await body(c, nodeUpdateSchema)
  const id = c.req.param('id')
  const current = await db(c.env)
    .select({
      id: nodeEntries.id,
      nodeId: nodeEntries.nodeId,
      name: nodeEntries.name,
      alias: nodeEntries.alias,
      enabled: nodeEntries.enabled,
      config: nodes.config,
      fingerprint: nodes.fingerprint,
    })
    .from(nodeEntries)
    .innerJoin(nodes, eq(nodes.id, nodeEntries.nodeId))
    .where(eq(nodeEntries.id, id))
    .get()
  if (!current) return fail(c, 404, 'NODE_NOT_FOUND', '节点不存在')
  const kinds = await nodeKinds(c.env, [id])
  const nodeManagement = management(kinds.get(id) || [])
  if (input.connection && input.yaml) return fail(c, 422, 'NODE_UPDATE_CONFLICT', '表单参数和 YAML 不能同时提交')
  if ((input.connection || input.yaml) && nodeManagement !== 'manual')
    return fail(c, 409, 'NODE_MANAGED_BY_SOURCE', '订阅管理的连接参数不能修改')
  let config = input.connection ? buildManualConfig(input.connection, current.config) : current.config
  if (input.yaml) {
    let parsed: ReturnType<typeof parseEditableProxyYaml>
    try {
      parsed = parseEditableProxyYaml(input.yaml)
    } catch (reason) {
      return fail(c, 422, 'NODE_YAML_INVALID', reason instanceof Error ? reason.message : 'YAML 内容无效')
    }
    if (!importProtocols.has(parsed.type))
      return fail(c, 422, 'NODE_PROTOCOL_UNSUPPORTED', `不支持 ${parsed.type} 协议`)
    config = restoreProxySecrets(parsed, current.config)
    const configError = proxyConfigError(config)
    if (configError) return fail(c, 422, 'NODE_YAML_INVALID', configError)
  }
  const connectionChanged = Boolean(input.connection || input.yaml)
  const nodeFingerprint = connectionChanged ? await fingerprint(config) : current.fingerprint
  const directTagNames = input.tags === undefined ? undefined : normalizeTagInputs(input.tags, 10)
  let nodeId = current.nodeId
  if (connectionChanged) {
    const existing = await db(c.env)
      .select({ id: nodes.id })
      .from(nodes)
      .where(eq(nodes.fingerprint, nodeFingerprint))
      .get()
    if (existing && existing.id !== current.nodeId) nodeId = existing.id
    else if (!existing) nodeId = await ensurePhysicalNode(c.env, config, nodeFingerprint, Date.now())
    if (existing?.id === current.nodeId)
      await db(c.env)
        .update(nodes)
        .set({ protocol: config.type, server: config.server, port: config.port, config, updatedAt: new Date() })
        .where(eq(nodes.id, current.nodeId))
  }
  await db(c.env)
    .update(nodeEntries)
    .set({
      nodeId: connectionChanged ? nodeId : undefined,
      name: connectionChanged ? config.name : undefined,
      alias: input.alias === undefined ? undefined : input.alias || null,
      enabled: input.enabled,
      updatedAt: new Date(),
    })
    .where(eq(nodeEntries.id, id))
  if (directTagNames !== undefined) await replaceEntryDirectTags(c.env, id, directTagNames)
  if (connectionChanged)
    await db(c.env)
      .update(sourceEntries)
      .set({ originalName: config.name })
      .where(and(eq(sourceEntries.sourceId, MANUAL_SOURCE_ID), eq(sourceEntries.entryId, id)))
  await cleanupOrphanNodes(c.env)
  await enqueueProfilesForEntry(c.env, id)
  return ok(c, await entryView(c.env, id))
})

nodesRouter.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const current = await db(c.env).select({ id: nodeEntries.id }).from(nodeEntries).where(eq(nodeEntries.id, id)).get()
  if (!current) return fail(c, 404, 'NODE_NOT_FOUND', '节点不存在')
  const kinds = await nodeKinds(c.env, [id])
  if (!(kinds.get(id) || []).includes('manual')) return fail(c, 409, 'NODE_MANAGED_BY_SOURCE', '订阅管理的节点不能删除')
  const [{ value }] = await db(c.env)
    .select({ value: count() })
    .from(profileSourceBindings)
    .where(eq(profileSourceBindings.sourceId, MANUAL_SOURCE_ID))
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM source_entries WHERE source_id = ? AND entry_id = ?').bind(MANUAL_SOURCE_ID, id),
    c.env.DB.prepare(
      'DELETE FROM node_entries WHERE id = ? AND NOT EXISTS (SELECT 1 FROM source_entries WHERE entry_id = ?)',
    ).bind(id, id),
    c.env.DB.prepare(
      'UPDATE sources SET node_count = (SELECT count(*) FROM source_entries WHERE source_id = ?), updated_at = ? WHERE id = ?',
    ).bind(MANUAL_SOURCE_ID, Date.now(), MANUAL_SOURCE_ID),
  ])
  await cleanupOrphanNodes(c.env)
  await enqueueAffectedProfiles(c.env, MANUAL_SOURCE_ID)
  return ok(c, { id, affectedProfileCount: Number(value) })
})
