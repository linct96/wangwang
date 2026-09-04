import { Hono } from 'hono'
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm'
import type { PhysicalProxyConfig, ProxyConfig } from '../db'
import { nodes, physicalNodes, profileSourceBindings, sources } from '../db'
import { body, fail, ok } from '../http'
import {
  editableProxyYaml,
  fingerprint,
  namedProxyConfig,
  parseEditableProxyYaml,
  parseProxyText,
  proxyConfigError,
  restoreProxySecrets,
  shareUri,
  splitProxyConfig,
} from '../proxy/index'
import {
  cleanupOrphanPhysicalNodes,
  db,
  enqueueAffectedProfiles,
  enqueueProfilesForNode,
  enqueueProfilesForNodes,
} from '../tasks'
import {
  buildManualConfig,
  connectionView,
  MANUAL_SOURCE_ID,
  nodeBatchSchema,
  nodeCreateSchema,
  nodeDeleteBatchSchema,
  nodeImportSchema,
  nodeUpdateSchema,
  preferredNodeCreateSchema,
} from '../node-config'
import { mergeTagViews, normalizeTagInputs } from '../tag-model'
import { nodeTagViews, replaceNodeDirectTags, replaceNodeDirectTagsForNodes } from '../tag-store'
import type { PreferredEndpoint } from '../../shared/preferred-node'

export const nodesRouter = new Hono<{ Bindings: Env }>()
const importProtocols = new Set(['ss', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic', 'anytls'])

async function ensurePhysicalNode(env: Env, config: PhysicalProxyConfig, nodeFingerprint: string, now: number) {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    `INSERT INTO physical_nodes (id, fingerprint, protocol, server, port, config, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(fingerprint) DO NOTHING`,
  )
    .bind(id, nodeFingerprint, config.type, config.server, config.port, JSON.stringify(config), now, now)
    .run()
  const row = await env.DB.prepare('SELECT id FROM physical_nodes WHERE fingerprint = ?')
    .bind(nodeFingerprint)
    .first<{ id: string }>()
  if (!row) throw new Error('节点保存失败')
  return row.id
}

function tagPayload(view: {
  direct: Array<{ id: string; name: string }>
  inherited: Array<{ id: string; name: string }>
}) {
  return {
    tags: mergeTagViews(view.direct, view.inherited).map((tag) => tag.name),
    directTags: view.direct,
    inheritedTags: view.inherited,
  }
}

async function nodeView(env: Env, nodeId: string) {
  const row = await db(env)
    .select({
      id: nodes.id,
      originalName: nodes.originalName,
      alias: nodes.alias,
      enabled: nodes.enabled,
      updatedAt: nodes.updatedAt,
      createdAt: nodes.createdAt,
      sourceKind: sources.kind,
      fingerprint: physicalNodes.fingerprint,
      protocol: physicalNodes.protocol,
      server: physicalNodes.server,
      port: physicalNodes.port,
      config: physicalNodes.config,
    })
    .from(nodes)
    .innerJoin(physicalNodes, eq(physicalNodes.id, nodes.physicalNodeId))
    .innerJoin(sources, eq(sources.id, nodes.sourceId))
    .where(eq(nodes.id, nodeId))
    .get()
  if (!row) return null
  const view = (await nodeTagViews(env, [nodeId])).get(nodeId) || { direct: [], inherited: [] }
  const name = row.alias || row.originalName
  const management = row.sourceKind === 'manual' ? 'manual' : 'subscription'
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    name,
    alias: row.alias,
    protocol: row.protocol,
    server: row.server,
    port: row.port,
    url: shareUri(namedProxyConfig(row.config, name), name),
    ...tagPayload(view),
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    management,
    canEditConnection: management === 'manual',
    canDelete: management === 'manual',
  }
}

async function updateManualNodeCount(env: Env, now: number) {
  await env.DB.prepare(
    'UPDATE sources SET node_count = (SELECT count(*) FROM nodes WHERE source_id = ?), updated_at = ? WHERE id = ?',
  )
    .bind(MANUAL_SOURCE_ID, now, MANUAL_SOURCE_ID)
    .run()
}

async function runBatches(env: Env, statements: D1PreparedStatement[]) {
  for (let index = 0; index < statements.length; index += 80) await env.DB.batch(statements.slice(index, index + 80))
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function preferredConfig(source: PhysicalProxyConfig, sourceName: string, endpoint: PreferredEndpoint): ProxyConfig {
  const config = namedProxyConfig(structuredClone(source), sourceName)
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
  const [{ value }] = await db(c.env).select({ value: count() }).from(nodes)
  if (Number(value) >= 2000) return fail(c, 409, 'NODE_LIMIT', '全局节点数量已达到 2000 个')

  const named = buildManualConfig(input.connection)
  const { originalName, config } = splitProxyConfig(named)
  const nodeFingerprint = await fingerprint(config)
  const now = Date.now()
  const physicalNodeId = await ensurePhysicalNode(c.env, config, nodeFingerprint, now)
  const id = crypto.randomUUID()
  const position = await c.env.DB.prepare(
    'SELECT coalesce(max(position), -1) + 1 AS position FROM nodes WHERE source_id = ?',
  )
    .bind(MANUAL_SOURCE_ID)
    .first<{ position: number }>()
  await c.env.DB.prepare(
    `INSERT INTO nodes (id, source_id, physical_node_id, original_name, alias, enabled, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      MANUAL_SOURCE_ID,
      physicalNodeId,
      originalName,
      input.enabled ? 1 : 0,
      Number(position?.position || 0),
      now,
      now,
    )
    .run()
  await replaceNodeDirectTags(c.env, id, normalizeTagInputs(input.tags, 10))
  await updateManualNodeCount(c.env, now)
  await enqueueAffectedProfiles(c.env, MANUAL_SOURCE_ID)
  return c.json({ data: { node: await nodeView(c.env, id) } }, 201)
})

nodesRouter.post('/import', async (c) => {
  const input = await body(c, nodeImportSchema)
  let parsed: Awaited<ReturnType<typeof parseProxyText>>
  try {
    parsed = await parseProxyText(input.content)
  } catch (reason) {
    return fail(c, 422, 'NODE_IMPORT_INVALID', reason instanceof Error ? reason.message : '节点内容无效')
  }
  const supported = parsed.nodes.filter((node) => importProtocols.has(node.config.type))
  const rejected = parsed.nodes
    .filter((node) => !importProtocols.has(node.config.type))
    .map((node) => `${node.originalName}：不支持 ${node.config.type} 协议`)
  const warnings = [...parsed.warnings, ...rejected.slice(0, Math.max(0, 20 - parsed.warnings.length))]
  const database = db(c.env)
  const [{ value }] = await database.select({ value: count() }).from(nodes)
  if (Number(value) + supported.length > 2000)
    return fail(c, 409, 'NODE_LIMIT', `最多还能导入 ${Math.max(0, 2000 - Number(value))} 个节点`)

  if (supported.length) {
    const now = Date.now()
    const position = await c.env.DB.prepare(
      'SELECT coalesce(max(position), -1) + 1 AS position FROM nodes WHERE source_id = ?',
    )
      .bind(MANUAL_SOURCE_ID)
      .first<{ position: number }>()
    const physicalIds = new Map<string, string>()
    for (const node of supported)
      physicalIds.set(node.fingerprint, await ensurePhysicalNode(c.env, node.config, node.fingerprint, now))
    const nodeIds = supported.map(() => crypto.randomUUID())
    await runBatches(
      c.env,
      supported.map((node, index) =>
        c.env.DB.prepare(
          `INSERT INTO nodes (id, source_id, physical_node_id, original_name, alias, enabled, position, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
        ).bind(
          nodeIds[index],
          MANUAL_SOURCE_ID,
          physicalIds.get(node.fingerprint),
          node.originalName,
          input.enabled ? 1 : 0,
          Number(position?.position || 0) + index,
          now,
          now,
        ),
      ),
    )
    await replaceNodeDirectTagsForNodes(c.env, nodeIds, normalizeTagInputs(input.tags, 10))
    await updateManualNodeCount(c.env, now)
    await enqueueAffectedProfiles(c.env, MANUAL_SOURCE_ID)
  }
  return ok(c, { created: supported.length, skipped: parsed.nodes.length - supported.length, warnings })
})

nodesRouter.post('/preferred', async (c) => {
  const input = await body(c, preferredNodeCreateSchema)
  const sourceNodeIds = [...new Set(input.sourceNodeIds)]
  const sourceRows = await db(c.env)
    .select({ id: nodes.id, originalName: nodes.originalName, alias: nodes.alias, config: physicalNodes.config })
    .from(nodes)
    .innerJoin(physicalNodes, eq(physicalNodes.id, nodes.physicalNodeId))
    .where(inArray(nodes.id, sourceNodeIds))
  const sourceById = new Map(sourceRows.map((node) => [node.id, node]))
  const warnings = sourceNodeIds
    .filter((id) => !sourceById.has(id))
    .map((id) => `节点 ${id} 不存在`)
    .slice(0, 20)
  const candidates = new Map<string, { originalName: string; config: PhysicalProxyConfig; fingerprint: string }>()
  for (const sourceNodeId of sourceNodeIds) {
    const source = sourceById.get(sourceNodeId)
    if (!source) continue
    for (const endpoint of input.addresses) {
      const named = preferredConfig(source.config, source.alias || source.originalName, endpoint)
      const configError = proxyConfigError(named)
      if (configError) {
        if (warnings.length < 20) warnings.push(`${named.name}：${configError}`)
        continue
      }
      const split = splitProxyConfig(named)
      const nodeFingerprint = await fingerprint(split.config)
      candidates.set(nodeFingerprint, { ...split, fingerprint: nodeFingerprint })
    }
  }
  const created = [...candidates.values()]
  const [{ value }] = await db(c.env).select({ value: count() }).from(nodes)
  if (Number(value) + created.length > 2000)
    return fail(c, 409, 'NODE_LIMIT', `最多还能生成 ${Math.max(0, 2000 - Number(value))} 个节点`)

  if (created.length) {
    const now = Date.now()
    const position = await c.env.DB.prepare(
      'SELECT coalesce(max(position), -1) + 1 AS position FROM nodes WHERE source_id = ?',
    )
      .bind(MANUAL_SOURCE_ID)
      .first<{ position: number }>()
    const createdIds: string[] = []
    const statements: D1PreparedStatement[] = []
    for (const [index, node] of created.entries()) {
      const physicalNodeId = await ensurePhysicalNode(c.env, node.config, node.fingerprint, now)
      const id = crypto.randomUUID()
      createdIds.push(id)
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO nodes (id, source_id, physical_node_id, original_name, alias, enabled, position, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
        ).bind(
          id,
          MANUAL_SOURCE_ID,
          physicalNodeId,
          node.originalName,
          input.enabled ? 1 : 0,
          Number(position?.position || 0) + index,
          now,
          now,
        ),
      )
    }
    await runBatches(c.env, statements)
    await replaceNodeDirectTagsForNodes(c.env, createdIds, normalizeTagInputs(input.tags, 10))
    await updateManualNodeCount(c.env, now)
    await enqueueAffectedProfiles(c.env, MANUAL_SOURCE_ID)
  }
  return ok(c, {
    created: created.length,
    skipped: input.sourceNodeIds.length * input.addresses.length - created.length,
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
    protocol ? eq(physicalNodes.protocol, protocol) : undefined,
    enabled === 'true' ? eq(nodes.enabled, true) : enabled === 'false' ? eq(nodes.enabled, false) : undefined,
    tagId
      ? sql`(
          EXISTS (SELECT 1 FROM node_tags nt WHERE nt.node_id = ${nodes.id} AND nt.tag_id = ${tagId})
          OR EXISTS (SELECT 1 FROM source_tags st WHERE st.source_id = ${nodes.sourceId} AND st.tag_id = ${tagId})
        )`
      : undefined,
    query
      ? sql`instr(lower(coalesce(${nodes.alias}, ${nodes.originalName}, '') || ' ' || ${physicalNodes.server} || ' ' || ${physicalNodes.protocol}), lower(${query})) > 0`
      : undefined,
    eq(sources.enabled, true),
  )
  const database = db(c.env)
  const selection = {
    id: nodes.id,
    originalName: nodes.originalName,
    alias: nodes.alias,
    enabled: nodes.enabled,
    createdAt: nodes.createdAt,
    updatedAt: nodes.updatedAt,
    sourceKind: sources.kind,
    fingerprint: physicalNodes.fingerprint,
    protocol: physicalNodes.protocol,
    server: physicalNodes.server,
    port: physicalNodes.port,
    config: physicalNodes.config,
  }
  const [rows, [{ total }]] = await Promise.all([
    database
      .select(selection)
      .from(nodes)
      .innerJoin(physicalNodes, eq(physicalNodes.id, nodes.physicalNodeId))
      .innerJoin(sources, eq(sources.id, nodes.sourceId))
      .where(filters)
      .orderBy(asc(physicalNodes.protocol), asc(physicalNodes.server), asc(nodes.originalName), asc(nodes.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    database
      .select({ total: count() })
      .from(nodes)
      .innerJoin(physicalNodes, eq(physicalNodes.id, nodes.physicalNodeId))
      .innerJoin(sources, eq(sources.id, nodes.sourceId))
      .where(filters),
  ])
  const views = await nodeTagViews(
    c.env,
    rows.map((node) => node.id),
  )
  return ok(c, {
    items: rows.map(({ config, sourceKind, originalName, ...node }) => {
      const name = node.alias || originalName
      const management = sourceKind === 'manual' ? 'manual' : 'subscription'
      return {
        ...node,
        name,
        url: shareUri(namedProxyConfig(config, name), name),
        ...tagPayload(views.get(node.id) || { direct: [], inherited: [] }),
        management,
        canEditConnection: management === 'manual',
        canDelete: management === 'manual',
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
  await c.env.DB.prepare(`UPDATE nodes SET enabled = ?, updated_at = ? WHERE id IN (${placeholders})`)
    .bind(input.enabled ? 1 : 0, Date.now(), ...input.ids)
    .run()
  await enqueueProfilesForNodes(c.env, input.ids)
  return ok(c, { updated: input.ids.length })
})

nodesRouter.delete('/batch', async (c) => {
  const input = await body(c, nodeDeleteBatchSchema)
  const manual = await db(c.env)
    .select({ id: nodes.id })
    .from(nodes)
    .where(and(inArray(nodes.id, input.ids), eq(nodes.sourceId, MANUAL_SOURCE_ID)))
  const ids = manual.map(({ id }) => id)
  if (ids.length) {
    await db(c.env).delete(nodes).where(inArray(nodes.id, ids))
    await updateManualNodeCount(c.env, Date.now())
    await cleanupOrphanPhysicalNodes(c.env)
    await enqueueAffectedProfiles(c.env, MANUAL_SOURCE_ID)
  }
  return ok(c, { deleted: ids.length, skipped: input.ids.length - ids.length })
})

nodesRouter.get('/:id', async (c) => {
  const id = c.req.param('id')
  const view = await nodeView(c.env, id)
  if (!view) return fail(c, 404, 'NODE_NOT_FOUND', '节点不存在')
  const current = await db(c.env)
    .select({ originalName: nodes.originalName, config: physicalNodes.config, sourceKind: sources.kind })
    .from(nodes)
    .innerJoin(physicalNodes, eq(physicalNodes.id, nodes.physicalNodeId))
    .innerJoin(sources, eq(sources.id, nodes.sourceId))
    .where(eq(nodes.id, id))
    .get()
  const named = namedProxyConfig(current!.config, current!.originalName)
  return ok(c, {
    ...view,
    connection: current!.sourceKind === 'manual' ? connectionView(named) : null,
    yaml: current!.sourceKind === 'manual' ? editableProxyYaml(named) : null,
  })
})

nodesRouter.patch('/:id', async (c) => {
  const input = await body(c, nodeUpdateSchema)
  const id = c.req.param('id')
  const current = await db(c.env)
    .select({
      id: nodes.id,
      sourceId: nodes.sourceId,
      physicalNodeId: nodes.physicalNodeId,
      originalName: nodes.originalName,
      config: physicalNodes.config,
      fingerprint: physicalNodes.fingerprint,
    })
    .from(nodes)
    .innerJoin(physicalNodes, eq(physicalNodes.id, nodes.physicalNodeId))
    .where(eq(nodes.id, id))
    .get()
  if (!current) return fail(c, 404, 'NODE_NOT_FOUND', '节点不存在')
  if (input.connection && input.yaml) return fail(c, 422, 'NODE_UPDATE_CONFLICT', '表单参数和 YAML 不能同时提交')
  if ((input.connection || input.yaml) && current.sourceId !== MANUAL_SOURCE_ID)
    return fail(c, 409, 'NODE_MANAGED_BY_SOURCE', '订阅管理的连接参数不能修改')

  const currentNamed = namedProxyConfig(current.config, current.originalName)
  let named = input.connection ? buildManualConfig(input.connection, currentNamed) : currentNamed
  if (input.yaml) {
    try {
      named = restoreProxySecrets(parseEditableProxyYaml(input.yaml), currentNamed)
    } catch (reason) {
      return fail(c, 422, 'NODE_YAML_INVALID', reason instanceof Error ? reason.message : 'YAML 内容无效')
    }
    if (!importProtocols.has(named.type)) return fail(c, 422, 'NODE_PROTOCOL_UNSUPPORTED', `不支持 ${named.type} 协议`)
    const error = proxyConfigError(named)
    if (error) return fail(c, 422, 'NODE_YAML_INVALID', error)
  }

  const connectionChanged = Boolean(input.connection || input.yaml)
  let physicalNodeId = current.physicalNodeId
  let originalName: string | undefined
  if (connectionChanged) {
    const split = splitProxyConfig(named)
    originalName = split.originalName
    const nextFingerprint = await fingerprint(split.config)
    if (nextFingerprint !== current.fingerprint)
      physicalNodeId = await ensurePhysicalNode(c.env, split.config, nextFingerprint, Date.now())
  }
  await db(c.env)
    .update(nodes)
    .set({
      physicalNodeId,
      originalName,
      alias: input.alias === undefined ? undefined : input.alias || null,
      enabled: input.enabled,
      updatedAt: new Date(),
    })
    .where(eq(nodes.id, id))
  if (input.tags !== undefined) await replaceNodeDirectTags(c.env, id, normalizeTagInputs(input.tags, 10))
  await cleanupOrphanPhysicalNodes(c.env)
  await enqueueProfilesForNode(c.env, id)
  return ok(c, await nodeView(c.env, id))
})

nodesRouter.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const current = await db(c.env).select({ sourceId: nodes.sourceId }).from(nodes).where(eq(nodes.id, id)).get()
  if (!current) return fail(c, 404, 'NODE_NOT_FOUND', '节点不存在')
  if (current.sourceId !== MANUAL_SOURCE_ID) return fail(c, 409, 'NODE_MANAGED_BY_SOURCE', '订阅管理的节点不能删除')
  const [{ value }] = await db(c.env)
    .select({ value: count() })
    .from(profileSourceBindings)
    .where(eq(profileSourceBindings.sourceId, MANUAL_SOURCE_ID))
  await db(c.env).delete(nodes).where(eq(nodes.id, id))
  await updateManualNodeCount(c.env, Date.now())
  await cleanupOrphanPhysicalNodes(c.env)
  await enqueueAffectedProfiles(c.env, MANUAL_SOURCE_ID)
  return ok(c, { id, affectedProfileCount: Number(value) })
})
