import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

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
    userAgent: text('user_agent').notNull().default('clash-verge/v2.5.2'),
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

export type PhysicalProxyConfig = Record<string, unknown> & {
  type: string
  server: string
  port: number
}

export type ProxyConfig = PhysicalProxyConfig & { name: string }

export const physicalNodes = sqliteTable(
  'physical_nodes',
  {
    id: text('id').primaryKey(),
    fingerprint: text('fingerprint').notNull(),
    protocol: text('protocol').notNull(),
    server: text('server').notNull(),
    port: integer('port').notNull(),
    config: text('config', { mode: 'json' }).$type<PhysicalProxyConfig>().notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [uniqueIndex('physical_nodes_fingerprint_idx').on(table.fingerprint)],
)

export const nodes = sqliteTable(
  'nodes',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    physicalNodeId: text('physical_node_id')
      .notNull()
      .references(() => physicalNodes.id),
    originalName: text('original_name').notNull(),
    alias: text('alias'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    position: integer('position').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('nodes_source_position_idx').on(table.sourceId, table.position),
    index('nodes_physical_idx').on(table.physicalNodeId),
  ],
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

export const nodeTags = sqliteTable(
  'node_tags',
  {
    nodeId: text('node_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.nodeId, table.tagId] }),
    index('node_tags_tag_idx').on(table.tagId, table.nodeId),
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

export const templateSlots = sqliteTable(
  'template_slots',
  {
    templateId: text('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    position: integer('position').notNull(),
  },
  (table) => [primaryKey({ columns: [table.templateId, table.key] })],
)

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

export const profileNodeBinding = sqliteTable(
  'profile_node_binding',
  {
    profileId: text('profile_id')
      .primaryKey()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    mode: text('mode', { enum: ['source', 'node', 'tag'] }).notNull(),
    includeRegex: text('include_regex'),
    excludeRegex: text('exclude_regex'),
  },
  (table) => [
    check('profile_node_binding_mode_check', sql`${table.mode} IN ('source', 'node', 'tag')`),
    check(
      'profile_node_binding_node_regex_check',
      sql`${table.mode} IN ('source', 'tag') OR (${table.includeRegex} IS NULL AND ${table.excludeRegex} IS NULL)`,
    ),
  ],
)

export const profileNodeTags = sqliteTable(
  'profile_node_tags',
  {
    profileId: text('profile_id')
      .notNull()
      .references(() => profileNodeBinding.profileId, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.profileId, table.tagId] }),
    index('profile_node_tags_tag_idx').on(table.tagId, table.profileId),
  ],
)

export const profileNodeSources = sqliteTable(
  'profile_node_sources',
  {
    profileId: text('profile_id')
      .notNull()
      .references(() => profileNodeBinding.profileId, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.profileId, table.sourceId] }),
    index('profile_node_sources_source_idx').on(table.sourceId, table.profileId),
  ],
)

export const profileNodeNodes = sqliteTable(
  'profile_node_nodes',
  {
    profileId: text('profile_id')
      .notNull()
      .references(() => profileNodeBinding.profileId, { onDelete: 'cascade' }),
    nodeId: text('node_id').notNull(),
    position: integer('position').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.profileId, table.nodeId] }),
    index('profile_node_nodes_node_idx').on(table.nodeId, table.profileId),
    index('profile_node_nodes_position_idx').on(table.profileId, table.position),
  ],
)

export const profileSlotBindings = sqliteTable(
  'profile_slot_bindings',
  {
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    slotKey: text('slot_key').notNull(),
    mode: text('mode', { enum: ['source', 'node', 'tag'] }).notNull(),
    includeRegex: text('include_regex'),
    excludeRegex: text('exclude_regex'),
  },
  (table) => [
    primaryKey({ columns: [table.profileId, table.slotKey] }),
    check('profile_slot_bindings_mode_check', sql`${table.mode} IN ('source', 'node', 'tag')`),
    check(
      'profile_slot_bindings_node_regex_check',
      sql`${table.mode} IN ('source', 'tag') OR (${table.includeRegex} IS NULL AND ${table.excludeRegex} IS NULL)`,
    ),
  ],
)

export const profileSlotTags = sqliteTable(
  'profile_slot_tags',
  {
    profileId: text('profile_id').notNull(),
    slotKey: text('slot_key').notNull(),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.profileId, table.slotKey, table.tagId] }),
    foreignKey({
      columns: [table.profileId, table.slotKey],
      foreignColumns: [profileSlotBindings.profileId, profileSlotBindings.slotKey],
    }).onDelete('cascade'),
    index('profile_slot_tags_tag_idx').on(table.tagId, table.profileId),
  ],
)

export const profileSlotSources = sqliteTable(
  'profile_slot_sources',
  {
    profileId: text('profile_id').notNull(),
    slotKey: text('slot_key').notNull(),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.profileId, table.slotKey, table.sourceId] }),
    foreignKey({
      columns: [table.profileId, table.slotKey],
      foreignColumns: [profileSlotBindings.profileId, profileSlotBindings.slotKey],
    }).onDelete('cascade'),
    index('profile_slot_sources_source_idx').on(table.sourceId, table.profileId),
  ],
)

export const profileSlotNodes = sqliteTable(
  'profile_slot_nodes',
  {
    profileId: text('profile_id').notNull(),
    slotKey: text('slot_key').notNull(),
    nodeId: text('node_id').notNull(),
    position: integer('position').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.profileId, table.slotKey, table.nodeId] }),
    foreignKey({
      columns: [table.profileId, table.slotKey],
      foreignColumns: [profileSlotBindings.profileId, profileSlotBindings.slotKey],
    }).onDelete('cascade'),
    index('profile_slot_nodes_node_idx').on(table.nodeId, table.profileId),
    index('profile_slot_nodes_slot_position_idx').on(table.profileId, table.slotKey, table.position),
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

export type QueueMessage = {
  jobId: string
  type: JobType
  entityId: string
}
