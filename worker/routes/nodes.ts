import { Hono } from 'hono'
import { and, asc, count, eq, like, or, sql } from 'drizzle-orm'
import { body, fail, ok } from '../http'
import { nodes, profileSources, sourceNodes, sources } from '../db'
import { fingerprint } from '../proxy'
import { db, enqueueAffectedProfiles, enqueueProfilesForNode, enqueueProfilesForNodes } from '../tasks'
import {
  buildManualConfig,
  connectionView,
  management,
  MANUAL_SOURCE_ID,
  nodeBatchSchema,
  nodeCreateSchema,
  nodeKinds,
  nodeUpdateSchema,
} from '../node-config'

export const nodesRouter = new Hono<{ Bindings: Env }>()

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

nodesRouter.get('/', async (c) => {
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

nodesRouter.patch('/:id', async (c) => {
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
