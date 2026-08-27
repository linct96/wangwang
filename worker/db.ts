import { relations } from 'drizzle-orm'
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const sources = sqliteTable(
  'sources',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['url', 'manual'] }).notNull(),
    url: text('url'),
    pendingUrl: text('pending_url'),
    content: text('content'),
    refreshIntervalHours: integer('refresh_interval_hours').notNull().default(0),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    etag: text('etag'),
    lastModified: text('last_modified'),
    status: text('status', { enum: ['idle', 'refreshing', 'ready', 'error'] })
      .notNull()
      .default('idle'),
    warning: text('warning'),
    error: text('error'),
    nodeCount: integer('node_count').notNull().default(0),
    uploadBytes: integer('upload_bytes'),
    downloadBytes: integer('download_bytes'),
    totalBytes: integer('total_bytes'),
    expireAt: integer('expire_at'),
    infoRefreshedAt: integer('info_refreshed_at', { mode: 'timestamp_ms' }),
    lastRefreshedAt: integer('last_refreshed_at', { mode: 'timestamp_ms' }),
    nextRefreshAt: integer('next_refresh_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('sources_due_idx').on(table.enabled, table.nextRefreshAt)],
)

export type ProxyConfig = Record<string, unknown> & {
  name: string
  type: string
  server: string
  port: number
}

export const nodes = sqliteTable(
  'nodes',
  {
    id: text('id').primaryKey(),
    fingerprint: text('fingerprint').notNull(),
    protocol: text('protocol').notNull(),
    server: text('server').notNull(),
    port: integer('port').notNull(),
    config: text('config', { mode: 'json' }).$type<ProxyConfig>().notNull(),
    alias: text('alias'),
    tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default([]),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [uniqueIndex('nodes_fingerprint_idx').on(table.fingerprint)],
)

export const sourceNodes = sqliteTable(
  'source_nodes',
  {
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    nodeId: text('node_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    originalName: text('original_name').notNull(),
    position: integer('position').notNull(),
  },
  (table) => [primaryKey({ columns: [table.sourceId, table.nodeId] }), index('source_nodes_node_idx').on(table.nodeId)],
)

export type RuleModule = 'ads' | 'private' | 'cn'

export const profiles = sqliteTable('profiles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  protocols: text('protocols', { mode: 'json' }).$type<string[]>().notNull().default([]),
  tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default([]),
  ruleModules: text('rule_modules', { mode: 'json' }).$type<RuleModule[]>().notNull().default(['ads', 'private', 'cn']),
  dnsMode: text('dns_mode', { enum: ['fake-ip', 'redir-host'] })
    .notNull()
    .default('fake-ip'),
  tokenVersion: integer('token_version').notNull().default(1),
  revision: integer('revision').notNull().default(0),
  compiledYaml: text('compiled_yaml'),
  compiledAt: integer('compiled_at', { mode: 'timestamp_ms' }),
  error: text('error'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export const profileSources = sqliteTable(
  'profile_sources',
  {
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.profileId, table.sourceId] })],
)

export const profileNodeExclusions = sqliteTable(
  'profile_node_exclusions',
  {
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    nodeId: text('node_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.profileId, table.nodeId] })],
)

export type JobType = 'refresh_source' | 'compile_profile'
export type JobStatus = 'pending' | 'running' | 'succeeded' | 'failed'

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    type: text('type', { enum: ['refresh_source', 'compile_profile'] })
      .$type<JobType>()
      .notNull(),
    entityId: text('entity_id').notNull(),
    status: text('status', { enum: ['pending', 'running', 'succeeded', 'failed'] })
      .$type<JobStatus>()
      .notNull()
      .default('pending'),
    error: text('error'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
  },
  (table) => [index('jobs_entity_idx').on(table.type, table.entityId, table.createdAt)],
)

export const sourcesRelations = relations(sources, ({ many }) => ({ nodes: many(sourceNodes) }))
export const nodesRelations = relations(nodes, ({ many }) => ({ sources: many(sourceNodes) }))

export type QueueMessage = {
  jobId: string
  type: JobType
  entityId: string
}
