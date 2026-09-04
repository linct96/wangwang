import { relations, sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const adminAccount = sqliteTable(
  'admin_account',
  {
    id: integer('id').primaryKey(),
    passwordHash: text('password_hash').notNull(),
    passwordSalt: text('password_salt').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [check('admin_account_singleton_check', sql`${table.id} = 1`)],
)

export const adminSessions = sqliteTable(
  'admin_sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('admin_sessions_expiry_idx').on(table.expiresAt)],
)

export const sources = sqliteTable(
  'sources',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['url', 'manual'] }).notNull(),
    url: text('url'),
    pendingUrl: text('pending_url'),
    nodeNameFilter: text('node_name_filter'),
    userAgent: text('user_agent').notNull().default('mihomo'),
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
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [uniqueIndex('nodes_fingerprint_idx').on(table.fingerprint)],
)

/**
 * A node is the physical connection, while an entry is the independently
 * selectable name/tag/enabled variant shown to users and profiles.
 */
export const nodeEntries = sqliteTable(
  'node_entries',
  {
    id: text('id').primaryKey(),
    nodeId: text('node_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    alias: text('alias'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('node_entries_node_idx').on(table.nodeId)],
)

export const tags = sqliteTable(
  'tags',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [uniqueIndex('tags_normalized_name_idx').on(table.normalizedName)],
)

export const nodeEntryTags = sqliteTable(
  'node_entry_tags',
  {
    entryId: text('entry_id')
      .notNull()
      .references(() => nodeEntries.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.entryId, table.tagId] }),
    index('node_entry_tags_tag_idx').on(table.tagId, table.entryId),
  ],
)

export const sourceEntries = sqliteTable(
  'source_entries',
  {
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    entryId: text('entry_id')
      .notNull()
      .references(() => nodeEntries.id, { onDelete: 'cascade' }),
    sourceKey: text('source_key').notNull(),
    originalName: text('original_name').notNull(),
    position: integer('position').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sourceId, table.entryId] }),
    uniqueIndex('source_entries_key_idx').on(table.sourceId, table.sourceKey),
    index('source_entries_entry_idx').on(table.entryId),
  ],
)

export const sourceTags = sqliteTable(
  'source_tags',
  {
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.sourceId, table.tagId] }),
    index('source_tags_tag_idx').on(table.tagId, table.sourceId),
  ],
)

export type TemplateId = 'builtin:minimal' | 'builtin:standard' | 'builtin:full' | (string & {})

export const templates = sqliteTable('templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  yaml: text('yaml').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export const profiles = sqliteTable(
  'profiles',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    templateId: text('template_id').$type<TemplateId>().notNull().default('builtin:minimal'),
    tokenVersion: integer('token_version').notNull().default(1),
    revision: integer('revision').notNull().default(0),
    compiledYaml: text('compiled_yaml'),
    compiledAt: integer('compiled_at', { mode: 'timestamp_ms' }),
    error: text('error'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('profiles_template_id_idx').on(table.templateId)],
)

export const profileSourceBindings = sqliteTable(
  'profile_source_bindings',
  {
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    slotKey: text('slot_key').notNull(),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.profileId, table.slotKey, table.sourceId] }),
    index('profile_source_bindings_source_idx').on(table.sourceId, table.profileId),
  ],
)

export const profileTagFilters = sqliteTable(
  'profile_tag_filters',
  {
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.profileId, table.tagId] }),
    index('profile_tag_filters_tag_idx').on(table.tagId, table.profileId),
  ],
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

export const sourcesRelations = relations(sources, ({ many }) => ({
  entries: many(sourceEntries),
  tags: many(sourceTags),
  profiles: many(profileSourceBindings),
}))
export const nodesRelations = relations(nodes, ({ many }) => ({
  entries: many(nodeEntries),
}))
export const nodeEntriesRelations = relations(nodeEntries, ({ one, many }) => ({
  node: one(nodes, { fields: [nodeEntries.nodeId], references: [nodes.id] }),
  sources: many(sourceEntries),
  tags: many(nodeEntryTags),
}))
export const tagsRelations = relations(tags, ({ many }) => ({
  entries: many(nodeEntryTags),
  sources: many(sourceTags),
  profiles: many(profileTagFilters),
}))
export const profilesRelations = relations(profiles, ({ many }) => ({
  sources: many(profileSourceBindings),
  tagFilters: many(profileTagFilters),
}))

export type QueueMessage = {
  jobId: string
  type: JobType
  entityId: string
}
