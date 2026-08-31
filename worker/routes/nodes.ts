import { Hono } from 'hono'
import { and, asc, count, eq, sql } from 'drizzle-orm'
import { body, fail, ok } from '../http'
import { nodes, profileSources, sourceNodes, sources } from '../db'
import {
  editableProxyYaml,
  fingerprint,
  parseEditableProxyYaml,
  parseProxyText,
  proxyConfigError,
  restoreProxySecrets,
} from '../proxy/index'
import { db, enqueueAffectedProfiles, enqueueProfilesForNode, enqueueProfilesForNodes, mergeNodeTags } from '../tasks'
import {
  buildManualConfig,
  connectionView,
  management,
  MANUAL_SOURCE_ID,
  nodeBatchSchema,
  nodeCreateSchema,
  nodeImportSchema,
  nodeKinds,
  nodeSourceTags,
  nodeUpdateSchema,
} from '../node-config'

export const nodesRouter = new Hono<{ Bindings: Env }>()
const importProtocols = new Set(['ss', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic', 'anytls'])

nodesRouter.post('/', async (c) => {
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

nodesRouter.post('/import', async (c) => {
  const input = await body(c, nodeImportSchema)
  const database = db(c.env)
  const manualSource = await database
    .select({ id: sources.id })
    .from(sources)
    .where(eq(sources.id, MANUAL_SOURCE_ID))
    .get()
  if (!manualSource) return fail(c, 500, 'MIGRATION_REQUIRED', '数据库迁移未完成')

  let parsed: Awaited<ReturnType<typeof parseProxyText>>
  try {
    parsed = await parseProxyText(input.content)
  } catch (reason) {
    return fail(c, 422, 'NODE_IMPORT_INVALID', reason instanceof Error ? reason.message : '节点内容无效')
  }
  const [existing, [{ value }], [{ position }]] = await Promise.all([
    database.select({ fingerprint: nodes.fingerprint }).from(nodes),
    database.select({ value: count() }).from(nodes),
    database
      .select({ position: sql<number>`coalesce(max(${sourceNodes.position}), -1) + 1` })
      .from(sourceNodes)
      .where(eq(sourceNodes.sourceId, MANUAL_SOURCE_ID)),
  ])
  const fingerprints = new Set(existing.map((node) => node.fingerprint))
  const supported = parsed.nodes.filter(
    (node) => importProtocols.has(node.config.type) && !proxyConfigError(node.config),
  )
  const imported = supported.filter((node) => !fingerprints.has(node.fingerprint))
  const rejectedWarnings = parsed.nodes.flatMap((node) => {
    if (!importProtocols.has(node.config.type)) return [`${node.config.name}：不支持 ${node.config.type} 协议`]
    const error = proxyConfigError(node.config)
    return error ? [`${node.config.name}：${error}`] : []
  })
  const warnings = [...parsed.warnings, ...rejectedWarnings.slice(0, Math.max(0, 20 - parsed.warnings.length))]
  if (Number(value) + imported.length > 2000)
    return fail(c, 409, 'NODE_LIMIT', `最多还能导入 ${Math.max(0, 2000 - Number(value))} 个节点`)

  if (imported.length) {
    const now = Date.now()
    const tags = JSON.stringify([...new Set(input.tags)])
    const statements: D1PreparedStatement[] = []
    imported.forEach(({ config, fingerprint: nodeFingerprint }, index) => {
      const id = crypto.randomUUID()
      statements.push(
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
          tags,
          input.enabled ? 1 : 0,
          now,
          now,
        ),
        c.env.DB.prepare(
          'INSERT INTO source_nodes (source_id, node_id, original_name, position) VALUES (?, ?, ?, ?)',
        ).bind(MANUAL_SOURCE_ID, id, config.name, Number(position) + index),
      )
    })
    statements.push(
      c.env.DB.prepare(
        'UPDATE sources SET node_count = (SELECT count(*) FROM source_nodes WHERE source_id = ?), updated_at = ? WHERE id = ?',
      ).bind(MANUAL_SOURCE_ID, now, MANUAL_SOURCE_ID),
    )
    await c.env.DB.batch(statements)
    await enqueueAffectedProfiles(c.env, MANUAL_SOURCE_ID)
  }

  return ok(c, {
    created: imported.length,
    skipped: parsed.nodes.length - imported.length,
    warnings,
  })
})

nodesRouter.get('/', async (c) => {
  const page = Math.max(1, Number(c.req.query('page')) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query('pageSize')) || 50))
  const protocol = c.req.query('protocol')?.trim()
  const enabled = c.req.query('enabled')
  const filters = and(
    protocol ? eq(nodes.protocol, protocol) : undefined,
    enabled === 'true' ? eq(nodes.enabled, true) : enabled === 'false' ? eq(nodes.enabled, false) : undefined,
    sql`EXISTS (
      SELECT 1 FROM source_nodes sn
      JOIN sources s ON s.id = sn.source_id
      WHERE sn.node_id = ${nodes.id} AND s.enabled = 1
    )`,
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
  const nodeIds = rows.map((node) => node.id)
  const [kinds, sourceTags] = await Promise.all([nodeKinds(c.env, nodeIds), nodeSourceTags(c.env, nodeIds)])
  return ok(c, {
    items: rows.map(({ config, ...node }) => {
      const nodeManagement = management(kinds.get(node.id) || [])
      return {
        ...node,
        name: node.alias || config.name,
        tags: mergeNodeTags(node.tags, sourceTags.get(node.id) || []),
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
  await c.env.DB.prepare(`UPDATE nodes SET enabled = ?, updated_at = ? WHERE id IN (${placeholders})`)
    .bind(input.enabled ? 1 : 0, Date.now(), ...input.ids)
    .run()
  await enqueueProfilesForNodes(c.env, input.ids)
  return ok(c, { updated: input.ids.length })
})

nodesRouter.get('/:id', async (c) => {
  const current = await db(c.env)
    .select()
    .from(nodes)
    .where(eq(nodes.id, c.req.param('id')))
    .get()
  if (!current) return fail(c, 404, 'NODE_NOT_FOUND', '节点不存在')
  const [kinds, sourceTags] = await Promise.all([nodeKinds(c.env, [current.id]), nodeSourceTags(c.env, [current.id])])
  const nodeManagement = management(kinds.get(current.id) || [])
  const { config, ...safe } = current
  return ok(c, {
    ...safe,
    name: safe.alias || config.name,
    tags: mergeNodeTags(safe.tags, sourceTags.get(current.id) || []),
    management: nodeManagement,
    canEditConnection: nodeManagement === 'manual',
    canDelete: nodeManagement === 'manual' || nodeManagement === 'mixed',
    connection: nodeManagement === 'manual' ? connectionView(config) : null,
    yaml: nodeManagement === 'manual' ? editableProxyYaml(config) : null,
  })
})

nodesRouter.patch('/:id', async (c) => {
  const input = await body(c, nodeUpdateSchema)
  const id = c.req.param('id')
  const current = await db(c.env).select().from(nodes).where(eq(nodes.id, id)).get()
  if (!current) return fail(c, 404, 'NODE_NOT_FOUND', '节点不存在')
  const [kinds, sourceTags] = await Promise.all([nodeKinds(c.env, [id]), nodeSourceTags(c.env, [id])])
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
  if (connectionChanged) {
    const duplicate = await db(c.env)
      .select({ id: nodes.id })
      .from(nodes)
      .where(eq(nodes.fingerprint, nodeFingerprint))
      .get()
    if (duplicate && duplicate.id !== id) return fail(c, 409, 'NODE_DUPLICATE', '相同连接参数的节点已存在')
  }
  const inheritedTags = new Set(sourceTags.get(id) || [])
  const tags = input.tags ? [...new Set(input.tags.filter((tag) => !inheritedTags.has(tag)))] : undefined
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
  if (connectionChanged)
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
    tags: mergeNodeTags(safe.tags, [...inheritedTags]),
    management: nodeManagement,
    canEditConnection: nodeManagement === 'manual',
    canDelete: nodeManagement === 'manual' || nodeManagement === 'mixed',
  })
})

nodesRouter.delete('/:id', async (c) => {
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
