import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { migrateLegacySourceSlots, ensureLegacySourceSlotsMigrated } from '../worker/migrations/source-slots-migration'
import {
  sourceSlotUsage,
  canDeleteSource,
  canDisableSource,
  validateProfileSourceBindings,
} from '../worker/profile-source-bindings'
import {
  profiles,
  profileSources,
  profileSourceBindings,
  templates,
  sources,
  jobs,
  nodes,
  nodeEntries,
  sourceEntries,
  sourceTags,
  tags,
  profileTagFilters,
} from '../worker/db'
import { BUILTIN_TEMPLATE_SLOT_KEYS } from '../worker/templates/builtin'
import { parseTemplateYaml } from '../worker/templates/validator'
import { parseTemplateSourceSlots } from '../worker/templates/source-slots'
import { enqueueProfilesForTemplate, selectProfileSlotNodes } from '../worker/tasks'
import { profileSchema, profilesRouter } from '../worker/routes/profiles'
import { templatesRouter } from '../worker/routes/templates'
import { sourcesRouter } from '../worker/routes/sources'
import { resetLocksTableInitializedForTests } from '../worker/locks'

function createD1Adapter(sqliteDb: DatabaseSync) {
  function createStatement(query: string, params: any[] = []) {
    return {
      bind(...newParams: any[]) {
        return createStatement(query, newParams)
      },
      async all() {
        const stmt = sqliteDb.prepare(query)
        const results = stmt.all(...params)
        return { results, success: true, meta: {} }
      },
      async run() {
        const stmt = sqliteDb.prepare(query)
        const info = stmt.run(...params)
        return { results: [], success: true, meta: { changes: info.changes } }
      },
      async get() {
        const stmt = sqliteDb.prepare(query)
        const result = stmt.get(...params)
        return result
      },
      async first(colName?: string) {
        const stmt = sqliteDb.prepare(query)
        const row = stmt.get(...params) as any
        if (!row) return null
        return colName ? row[colName] : row
      },
      async raw() {
        const stmt = sqliteDb.prepare(query)
        const rows = stmt.all(...params) as any[]
        return rows.map((r) => Object.values(r))
      },
    }
  }

  return {
    prepare(query: string) {
      return createStatement(query)
    },
    async batch(statements: any[]) {
      const results = []
      for (const s of statements) {
        results.push(await s.run())
      }
      return results
    },
    async exec(query: string) {
      sqliteDb.exec(query)
      return { count: 0, duration: 0 }
    },
  } as unknown as D1Database
}

function createTestEnv(sqliteDb: DatabaseSync) {
  const d1 = createD1Adapter(sqliteDb)
  return {
    DB: d1,
    JOBS: {
      send: async () => {},
    },
    KV: {
      get: async () => null,
      put: async () => {},
      delete: async () => {},
    },
    SUBSCRIPTION_TOKEN_SECRET: 'test-secret',
  } as unknown as Env
}

describe('Real D1 legacy data migration & source slots lifecycle', () => {
  it('migrates legacy schema with profile_sources to dynamic slots safely and idempotently', async () => {
    const sqlite = new DatabaseSync(':memory:')
    const env = createTestEnv(sqlite)
    const database = drizzle(env.DB)

    // 1. Apply old schema (0000_initial and 0001_seed_manual_source)
    const sql0000 = fs.readFileSync(path.resolve('drizzle/0000_initial.sql'), 'utf8')
    sqlite.exec(sql0000)
    const sql0001 = fs.readFileSync(path.resolve('drizzle/0001_seed_manual_source.sql'), 'utf8')
    sqlite.exec(sql0001)

    // 2. Populate legacy data under old schema
    const now = new Date()
    await database.insert(sources).values([
      {
        id: 'src-main',
        name: '主力源',
        kind: 'url',
        enabled: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'src-backup',
        name: '备用源',
        kind: 'url',
        enabled: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'src-disabled',
        name: '已停用源',
        kind: 'url',
        enabled: false,
        createdAt: now,
        updatedAt: now,
      },
    ])

    const validLegacyYaml = `proxy-groups:
  - name: 节点选择
    type: select
    proxies:
      - __WANGWANG_CUSTOM_SOURCE_NODES__
      - DIRECT
rules:
  - MATCH,节点选择
`

    const invalidLegacyYaml = `proxy-groups:
  - name: 节点选择
    type: select
    proxies:
      - DIRECT
rules:
  - MATCH,节点选择
`

    sqlite
      .prepare(`
      INSERT INTO templates (id, name, yaml, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `)
      .run('tpl-valid', '可迁移模板', validLegacyYaml, now.getTime(), now.getTime())

    sqlite
      .prepare(`
      INSERT INTO templates (id, name, yaml, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `)
      .run('tpl-invalid', '缺占位符模板', invalidLegacyYaml, now.getTime(), now.getTime())

    await database.insert(profiles).values([
      {
        id: 'p-builtin',
        name: '内置模板配置',
        templateId: 'builtin:minimal',
        compiledYaml: '# compiled builtin config',
        compiledAt: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'p-valid',
        name: '自定义合法配置',
        templateId: 'tpl-valid',
        compiledYaml: '# compiled custom valid',
        compiledAt: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'p-invalid',
        name: '自定义无法迁移配置',
        templateId: 'tpl-invalid',
        compiledYaml: '# compiled custom invalid',
        compiledAt: now,
        createdAt: now,
        updatedAt: now,
      },
    ])

    // Insert legacy relations into profile_sources table
    await database.insert(profileSources).values([
      { profileId: 'p-builtin', sourceId: 'src-main' },
      { profileId: 'p-builtin', sourceId: 'src-backup' },
      { profileId: 'p-valid', sourceId: 'src-main' },
      { profileId: 'p-invalid', sourceId: 'src-main' },
    ])

    // 3. Apply 0002 migration (adding profile_source_bindings and migration_status)
    const sql0002 = fs.readFileSync(path.resolve('drizzle/0002_windy_nightshade.sql'), 'utf8')
    for (const stmt of sql0002.split('--> statement-breakpoint')) {
      if (stmt.trim()) sqlite.exec(stmt.trim())
    }

    // 4. Run data migration
    const result = await migrateLegacySourceSlots(env)
    expect(result.migratedTemplates).toBe(1)
    expect(result.failedTemplates).toBe(1)
    expect(result.migratedProfiles).toBe(3)

    // 5. Verify profile_source_bindings table entries
    const bindings = await database.select().from(profileSourceBindings)
    expect(bindings).toHaveLength(3)

    // Builtin profile sources mapped to mini01 slot key
    const builtinBindings = bindings.filter((b) => b.profileId === 'p-builtin')
    expect(builtinBindings).toHaveLength(2)
    expect(builtinBindings.every((b) => b.slotKey === BUILTIN_TEMPLATE_SLOT_KEYS['builtin:minimal'])).toBe(true)

    // Valid custom profile mapped to new generated slot key
    const validCustomTpl = await database.select().from(templates).where(eq(templates.id, 'tpl-valid')).get()
    expect(validCustomTpl?.migrationStatus).toBe('ready')
    expect(validCustomTpl?.migrationError).toBeNull()
    expect(validCustomTpl?.yaml).not.toContain('__WANGWANG_CUSTOM_SOURCE_NODES__')
    const parsedValid = parseTemplateYaml(validCustomTpl!.yaml)
    const validSlotKey = parseTemplateSourceSlots(parsedValid)[0].key

    const customBindings = bindings.filter((b) => b.profileId === 'p-valid')
    expect(customBindings).toHaveLength(1)
    expect(customBindings[0].slotKey).toBe(validSlotKey)
    expect(customBindings[0].sourceId).toBe('src-main')

    // Invalid custom template marked as needs_repair
    const invalidCustomTpl = await database.select().from(templates).where(eq(templates.id, 'tpl-invalid')).get()
    expect(invalidCustomTpl?.migrationStatus).toBe('needs_repair')
    expect(invalidCustomTpl?.migrationError).toMatch(
      /模板必须包含 1 到 20 个节点源槽位|未包含旧版节点源占位符|未在代理组/,
    )
    expect(invalidCustomTpl?.yaml).toBe(invalidLegacyYaml)

    // Legacy profile_sources table is UNCHANGED and NOT deleted
    const legacyRemaining = await database.select().from(profileSources)
    expect(legacyRemaining).toHaveLength(4)

    // Compiled YAML of all profiles was preserved and NEVER cleared
    const preservedProfiles = await database.select().from(profiles)
    for (const p of preservedProfiles) {
      expect(p.compiledYaml).toBeTruthy()
    }
    const pInvalid = preservedProfiles.find((p) => p.id === 'p-invalid')
    expect(pInvalid?.compiledYaml).toBe('# compiled custom invalid')

    // 6. Test Idempotency: re-running migration does not duplicate or re-run
    const reRunResult = await migrateLegacySourceSlots(env)
    expect(reRunResult).toEqual({
      migratedTemplates: 0,
      failedTemplates: 0,
      migratedProfiles: 0,
    })
    const bindingsAfterReRun = await database.select().from(profileSourceBindings)
    expect(bindingsAfterReRun).toHaveLength(3)

    // 7. Verify sourceSlotUsage single-query optimization and guards on the real DB
    const usages = await sourceSlotUsage(env, 'src-main')
    expect(usages.length).toBeGreaterThanOrEqual(2)

    // src-main is sole bound source for p-valid slot -> canDeleteSource is false
    const deleteCheck = canDeleteSource(usages)
    expect(deleteCheck.allowed).toBe(false)
    expect(deleteCheck.violation?.profileId).toBe('p-valid')

    // src-backup is only in p-builtin alongside src-main (boundCount = 2, enabledCount = 2)
    const backupUsages = await sourceSlotUsage(env, 'src-backup')
    const backupDeleteCheck = canDeleteSource(backupUsages)
    expect(backupDeleteCheck.allowed).toBe(true)
  })

  it('handles concurrent migration execution across simulated isolates safely with atomic claim', async () => {
    const sqlite = new DatabaseSync(':memory:')
    const env = createTestEnv(sqlite)
    const database = drizzle(env.DB)

    // Apply old schema
    sqlite.exec(fs.readFileSync(path.resolve('drizzle/0000_initial.sql'), 'utf8'))
    sqlite.exec(fs.readFileSync(path.resolve('drizzle/0001_seed_manual_source.sql'), 'utf8'))

    const now = new Date()
    await database.insert(sources).values([
      { id: 'src-conc-1', name: '源1', kind: 'url', enabled: true, createdAt: now, updatedAt: now },
      { id: 'src-conc-2', name: '源2', kind: 'url', enabled: true, createdAt: now, updatedAt: now },
    ])

    const validLegacyYaml = `proxy-groups:
  - name: 节点选择
    type: select
    proxies:
      - __WANGWANG_CUSTOM_SOURCE_NODES__
rules:
  - MATCH,节点选择
`
    sqlite
      .prepare(`
      INSERT INTO templates (id, name, yaml, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `)
      .run('tpl-conc', '并发测试模板', validLegacyYaml, now.getTime(), now.getTime())

    await database.insert(profiles).values([
      {
        id: 'p-conc',
        name: '并发配置',
        templateId: 'tpl-conc',
        compiledYaml: '# initial yaml',
        createdAt: now,
        updatedAt: now,
      },
    ])

    await database.insert(profileSources).values([
      { profileId: 'p-conc', sourceId: 'src-conc-1' },
      { profileId: 'p-conc', sourceId: 'src-conc-2' },
    ])

    // Apply 0002
    for (const stmt of fs
      .readFileSync(path.resolve('drizzle/0002_windy_nightshade.sql'), 'utf8')
      .split('--> statement-breakpoint')) {
      if (stmt.trim()) sqlite.exec(stmt.trim())
    }

    // Run 3 concurrent migrations simultaneously simulating 3 Worker isolates
    const results = await Promise.all([
      migrateLegacySourceSlots(env),
      migrateLegacySourceSlots(env),
      migrateLegacySourceSlots(env),
    ])

    // Exactly one isolate performs the migration; the others resolve to 0
    const totalMigrated = results.reduce((sum, r) => sum + r.migratedTemplates, 0)
    expect(totalMigrated).toBe(1)

    // Verify atomic state in _app_migrations
    const migrationRecord = await database.get<{ status: string }>(
      sql`SELECT status FROM _app_migrations WHERE name = 'source_slots_v1'`,
    )
    expect(migrationRecord?.status).toBe('completed')

    // Custom template has exactly 1 valid generated slot key
    const tpl = await database.select().from(templates).where(eq(templates.id, 'tpl-conc')).get()
    expect(tpl?.yaml).not.toContain('__WANGWANG_CUSTOM_SOURCE_NODES__')
    const slots = parseTemplateSourceSlots(parseTemplateYaml(tpl!.yaml))
    expect(slots).toHaveLength(1)

    // profile_source_bindings has exactly 2 bindings mapped to that single slot
    const bindings = await database.select().from(profileSourceBindings)
    expect(bindings).toHaveLength(2)
    expect(bindings.every((b) => b.slotKey === slots[0].key)).toBe(true)
  })

  it('migration state machine: retries on failed status and completes', async () => {
    const sqlite = new DatabaseSync(':memory:')
    const env = createTestEnv(sqlite)
    const database = drizzle(env.DB)

    sqlite.exec(fs.readFileSync(path.resolve('drizzle/0000_initial.sql'), 'utf8'))
    sqlite.exec(fs.readFileSync(path.resolve('drizzle/0001_seed_manual_source.sql'), 'utf8'))

    const now = new Date()
    await database
      .insert(sources)
      .values([{ id: 'src-m1', name: '源1', kind: 'url', enabled: true, createdAt: now, updatedAt: now }])

    const validLegacyYaml = `proxy-groups:
  - name: 节点选择
    type: select
    proxies:
      - __WANGWANG_CUSTOM_SOURCE_NODES__
rules:
  - MATCH,节点选择
`
    sqlite
      .prepare(`
      INSERT INTO templates (id, name, yaml, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `)
      .run('tpl-m1', '模板1', validLegacyYaml, now.getTime(), now.getTime())

    await database
      .insert(profiles)
      .values([
        { id: 'p-m1', name: '配置1', templateId: 'tpl-m1', compiledYaml: '# yaml', createdAt: now, updatedAt: now },
      ])
    await database.insert(profileSources).values([{ profileId: 'p-m1', sourceId: 'src-m1' }])

    for (const stmt of fs
      .readFileSync(path.resolve('drizzle/0002_windy_nightshade.sql'), 'utf8')
      .split('--> statement-breakpoint')) {
      if (stmt.trim()) sqlite.exec(stmt.trim())
    }

    // Pre-populate _app_migrations with status = 'failed'
    await database.run(sql`
      CREATE TABLE IF NOT EXISTS _app_migrations (name TEXT PRIMARY KEY, status TEXT NOT NULL, applied_at INTEGER NOT NULL)
    `)
    await database.run(sql`
      INSERT INTO _app_migrations (name, status, applied_at)
      VALUES ('source_slots_v1', 'failed', ${Date.now() - 5000})
    `)

    // Execute migration: should CAS takeover from failed, run migration, and complete!
    const result = await migrateLegacySourceSlots(env)
    expect(result.migratedTemplates).toBe(1)
    expect(result.migratedProfiles).toBe(1)

    const statusRecord = await database.get<{ status: string }>(
      sql`SELECT status FROM _app_migrations WHERE name = 'source_slots_v1'`,
    )
    expect(statusRecord?.status).toBe('completed')
  })

  it('migration state machine: takes over stale running status and completes', async () => {
    const sqlite = new DatabaseSync(':memory:')
    const env = createTestEnv(sqlite)
    const database = drizzle(env.DB)

    sqlite.exec(fs.readFileSync(path.resolve('drizzle/0000_initial.sql'), 'utf8'))
    sqlite.exec(fs.readFileSync(path.resolve('drizzle/0001_seed_manual_source.sql'), 'utf8'))

    const now = new Date()
    await database
      .insert(sources)
      .values([{ id: 'src-m2', name: '源2', kind: 'url', enabled: true, createdAt: now, updatedAt: now }])

    const validLegacyYaml = `proxy-groups:
  - name: 节点选择
    type: select
    proxies:
      - __WANGWANG_CUSTOM_SOURCE_NODES__
rules:
  - MATCH,节点选择
`
    sqlite
      .prepare(`
      INSERT INTO templates (id, name, yaml, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `)
      .run('tpl-m2', '模板2', validLegacyYaml, now.getTime(), now.getTime())

    await database
      .insert(profiles)
      .values([
        { id: 'p-m2', name: '配置2', templateId: 'tpl-m2', compiledYaml: '# yaml', createdAt: now, updatedAt: now },
      ])
    await database.insert(profileSources).values([{ profileId: 'p-m2', sourceId: 'src-m2' }])

    for (const stmt of fs
      .readFileSync(path.resolve('drizzle/0002_windy_nightshade.sql'), 'utf8')
      .split('--> statement-breakpoint')) {
      if (stmt.trim()) sqlite.exec(stmt.trim())
    }

    // Pre-populate _app_migrations with status = 'running' older than 60s
    await database.run(sql`
      CREATE TABLE IF NOT EXISTS _app_migrations (name TEXT PRIMARY KEY, status TEXT NOT NULL, applied_at INTEGER NOT NULL)
    `)
    await database.run(sql`
      INSERT INTO _app_migrations (name, status, applied_at)
      VALUES ('source_slots_v1', 'running', ${Date.now() - 70_000})
    `)

    // Execute migration: should CAS takeover from stale running, run migration, and complete!
    const result = await migrateLegacySourceSlots(env)
    expect(result.migratedTemplates).toBe(1)
    expect(result.migratedProfiles).toBe(1)

    const statusRecord = await database.get<{ status: string }>(
      sql`SELECT status FROM _app_migrations WHERE name = 'source_slots_v1'`,
    )
    expect(statusRecord?.status).toBe('completed')
  })

  it('migration state machine: active running status times out and fails-closed', async () => {
    const sqlite = new DatabaseSync(':memory:')
    const env = createTestEnv(sqlite)
    const database = drizzle(env.DB)

    sqlite.exec(fs.readFileSync(path.resolve('drizzle/0000_initial.sql'), 'utf8'))
    sqlite.exec(fs.readFileSync(path.resolve('drizzle/0001_seed_manual_source.sql'), 'utf8'))
    for (const stmt of fs
      .readFileSync(path.resolve('drizzle/0002_windy_nightshade.sql'), 'utf8')
      .split('--> statement-breakpoint')) {
      if (stmt.trim()) sqlite.exec(stmt.trim())
    }

    // Pre-populate _app_migrations with status = 'running' created just now (< 60s)
    await database.run(sql`
      CREATE TABLE IF NOT EXISTS _app_migrations (name TEXT PRIMARY KEY, status TEXT NOT NULL, applied_at INTEGER NOT NULL)
    `)
    await database.run(sql`
      INSERT INTO _app_migrations (name, status, applied_at)
      VALUES ('source_slots_v1', 'running', ${Date.now()})
    `)

    // Should poll for ~2.5s and throw MIGRATION_IN_PROGRESS (fail-closed, not returning success)
    await expect(migrateLegacySourceSlots(env)).rejects.toThrow(/MIGRATION_IN_PROGRESS/)
  })

  it('enforces real concurrent invariant guards on source disable and delete using Promise.all', async () => {
    const sqlite = new DatabaseSync(':memory:')
    const env = createTestEnv(sqlite)
    const database = drizzle(env.DB)

    // Apply complete schema
    sqlite.exec(fs.readFileSync(path.resolve('drizzle/0000_initial.sql'), 'utf8'))
    sqlite.exec(fs.readFileSync(path.resolve('drizzle/0001_seed_manual_source.sql'), 'utf8'))
    for (const stmt of fs
      .readFileSync(path.resolve('drizzle/0002_windy_nightshade.sql'), 'utf8')
      .split('--> statement-breakpoint')) {
      if (stmt.trim()) sqlite.exec(stmt.trim())
    }

    const now = new Date()
    await database.insert(sources).values([
      { id: 's1', name: '源1', kind: 'url', enabled: true, createdAt: now, updatedAt: now },
      { id: 's2', name: '源2', kind: 'url', enabled: true, createdAt: now, updatedAt: now },
    ])

    const slotKey = '__WANGWANG_SOURCE_SLOT_test01__'
    const tplYaml = `x-wangwang:
  sources:
    - key: ${slotKey}
      name: 测试槽位
proxy-groups:
  - name: 节点选择
    type: select
    proxies:
      - ${slotKey}
rules:
  - MATCH,节点选择
`
    await database.insert(templates).values({
      id: 'tpl-1',
      name: '模板1',
      yaml: tplYaml,
      migrationStatus: 'ready',
      createdAt: now,
      updatedAt: now,
    })

    await database.insert(profiles).values({
      id: 'p1',
      name: '配置1',
      templateId: 'tpl-1',
      compiledYaml: '# yaml',
      createdAt: now,
      updatedAt: now,
    })

    await database.insert(profileSourceBindings).values([
      { profileId: 'p1', slotKey, sourceId: 's1' },
      { profileId: 'p1', slotKey, sourceId: 's2' },
    ])

    // Concurrent disable: s1 and s2 both attempt disable at the same time
    const [patchRes1, patchRes2] = await Promise.all([
      sourcesRouter.request(
        '/s1',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: false }),
        },
        env,
      ),
      sourcesRouter.request(
        '/s2',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: false }),
        },
        env,
      ),
    ])

    const patchStatuses = [patchRes1.status, patchRes2.status].sort()
    expect(patchStatuses).toEqual([200, 409])

    // Verify DB invariant: between s1 and s2, exactly 1 source remains enabled
    const remainingSources = await database.select().from(sources)
    const testSources = remainingSources.filter((s) => s.id === 's1' || s.id === 's2')
    const enabledCount = testSources.filter((s) => s.enabled).length
    expect(enabledCount).toBe(1)

    // Re-enable so both are enabled
    await database.update(sources).set({ enabled: true })

    // Concurrent delete: s1 and s2 both attempt delete at the same time
    const [delRes1, delRes2] = await Promise.all([
      sourcesRouter.request('/s1', { method: 'DELETE' }, env),
      sourcesRouter.request('/s2', { method: 'DELETE' }, env),
    ])

    const delStatuses = [delRes1.status, delRes2.status].sort()
    expect(delStatuses).toEqual([200, 409])

    // Verify DB invariant: exactly 1 source remains bound
    const remainingBindings = await database.select().from(profileSourceBindings)
    expect(remainingBindings).toHaveLength(1)
  })

  it('enforces integrity lock on concurrent profile patch and source disable', async () => {
    const sqlite = new DatabaseSync(':memory:')
    const env = createTestEnv(sqlite)
    const database = drizzle(env.DB)

    sqlite.exec(fs.readFileSync(path.resolve('drizzle/0000_initial.sql'), 'utf8'))
    sqlite.exec(fs.readFileSync(path.resolve('drizzle/0001_seed_manual_source.sql'), 'utf8'))
    for (const stmt of fs
      .readFileSync(path.resolve('drizzle/0002_windy_nightshade.sql'), 'utf8')
      .split('--> statement-breakpoint')) {
      if (stmt.trim()) sqlite.exec(stmt.trim())
    }

    const now = new Date()
    await database.insert(sources).values([
      { id: 'src-a', name: '源A', kind: 'url', enabled: true, createdAt: now, updatedAt: now },
      { id: 'src-b', name: '源B', kind: 'url', enabled: true, createdAt: now, updatedAt: now },
    ])

    const slotKey = '__WANGWANG_SOURCE_SLOT_race__'
    const tplYaml = `x-wangwang:
  sources:
    - key: ${slotKey}
      name: 竞态槽位
proxy-groups:
  - name: 节点选择
    type: select
    proxies:
      - ${slotKey}
rules:
  - MATCH,节点选择
`
    await database.insert(templates).values({
      id: 'tpl-race',
      name: '竞态模板',
      yaml: tplYaml,
      migrationStatus: 'ready',
      createdAt: now,
      updatedAt: now,
    })

    await database.insert(profiles).values({
      id: 'p-race',
      name: '竞态配置',
      templateId: 'tpl-race',
      compiledYaml: '# yaml',
      createdAt: now,
      updatedAt: now,
    })

    await database.insert(profileSourceBindings).values([
      { profileId: 'p-race', slotKey, sourceId: 'src-a' },
      { profileId: 'p-race', slotKey, sourceId: 'src-b' },
    ])

    // Concurrently run:
    // 1) Profile patch to restrict slot to ONLY src-a
    // 2) Source disable on src-a
    const [patchProfileRes, disableSourceRes] = await Promise.all([
      profilesRouter.request(
        '/p-race',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceBindings: [{ slotKey, sourceIds: ['src-a'] }],
          }),
        },
        env,
      ),
      sourcesRouter.request(
        '/src-a',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: false }),
        },
        env,
      ),
    ])

    // At least one must maintain the invariant
    expect([patchProfileRes.status, disableSourceRes.status].some((s) => s >= 400)).toBe(true)

    // Invariant check: the slot must still have at least 1 enabled source
    const currentBindings = await database
      .select()
      .from(profileSourceBindings)
      .where(eq(profileSourceBindings.profileId, 'p-race'))
    const allSources = await database.select().from(sources)
    const sourceMap = new Map(allSources.map((s) => [s.id, s.enabled]))
    const enabledInSlot = currentBindings.filter((b) => sourceMap.get(b.sourceId)).length
    expect(enabledInSlot).toBeGreaterThanOrEqual(1)
  })

  it('isolates inherited source tags by (entryId, sourceId) in selectProfileSlotNodes', async () => {
    const sqlite = new DatabaseSync(':memory:')
    const env = createTestEnv(sqlite)
    const database = drizzle(env.DB)

    sqlite.exec(fs.readFileSync(path.resolve('drizzle/0000_initial.sql'), 'utf8'))
    sqlite.exec(fs.readFileSync(path.resolve('drizzle/0001_seed_manual_source.sql'), 'utf8'))
    for (const stmt of fs
      .readFileSync(path.resolve('drizzle/0002_windy_nightshade.sql'), 'utf8')
      .split('--> statement-breakpoint')) {
      if (stmt.trim()) sqlite.exec(stmt.trim())
    }

    const now = new Date()
    // Create Sources: src-hk and src-jp
    await database.insert(sources).values([
      { id: 'src-hk', name: '香港源', kind: 'url', enabled: true, createdAt: now, updatedAt: now },
      { id: 'src-jp', name: '日本源', kind: 'url', enabled: true, createdAt: now, updatedAt: now },
    ])

    // Create Tags: HK and JP
    await database.insert(tags).values([
      { id: 'tag-hk', name: '香港', normalizedName: '香港', createdAt: now, updatedAt: now },
      { id: 'tag-jp', name: '日本', normalizedName: '日本', createdAt: now, updatedAt: now },
    ])

    // Associate tags with sources
    await database.insert(sourceTags).values([
      { sourceId: 'src-hk', tagId: 'tag-hk' },
      { sourceId: 'src-jp', tagId: 'tag-jp' },
    ])

    // Shared node and entry
    await database.insert(nodes).values({
      id: 'node-shared',
      fingerprint: 'fp-shared',
      protocol: 'ss',
      server: '1.2.3.4',
      port: 8388,
      config: { name: '香港日本双线节点', type: 'ss', server: '1.2.3.4', port: 8388 },
      createdAt: now,
      updatedAt: now,
    })

    await database.insert(nodeEntries).values({
      id: 'entry-shared',
      nodeId: 'node-shared',
      name: '双线节点入口',
      enabled: true,
      createdAt: now,
      updatedAt: now,
    })

    await database.insert(sourceEntries).values([
      { sourceId: 'src-hk', entryId: 'entry-shared', sourceKey: 'k-hk-1', originalName: '节点1', position: 0 },
      { sourceId: 'src-jp', entryId: 'entry-shared', sourceKey: 'k-jp-1', originalName: '节点1', position: 0 },
    ])

    // Template with 2 slots: slot-hk and slot-jp
    const slotHkKey = '__WANGWANG_SOURCE_SLOT_hk__'
    const slotJpKey = '__WANGWANG_SOURCE_SLOT_jp__'
    const templateYaml = `x-wangwang:
  sources:
    - key: ${slotHkKey}
      name: 香港槽位
    - key: ${slotJpKey}
      name: 日本槽位
proxy-groups:
  - name: 节点选择
    type: select
    proxies:
      - ${slotHkKey}
      - ${slotJpKey}
rules:
  - MATCH,节点选择
`
    await database.insert(templates).values({
      id: 'tpl-tags',
      name: '多标签模板',
      yaml: templateYaml,
      migrationStatus: 'ready',
      createdAt: now,
      updatedAt: now,
    })

    await database.insert(profiles).values({
      id: 'p-tags',
      name: '日本过滤配置',
      templateId: 'tpl-tags',
      compiledYaml: '# yaml',
      createdAt: now,
      updatedAt: now,
    })

    await database.insert(profileSourceBindings).values([
      { profileId: 'p-tags', slotKey: slotHkKey, sourceId: 'src-hk' },
      { profileId: 'p-tags', slotKey: slotJpKey, sourceId: 'src-jp' },
    ])

    // Filter by tag-jp (日本)
    await database.insert(profileTagFilters).values({
      profileId: 'p-tags',
      tagId: 'tag-jp',
    })

    // Execute selectProfileSlotNodes
    const prof = await database.select().from(profiles).where(eq(profiles.id, 'p-tags')).get()
    const selected = await selectProfileSlotNodes(env, prof!)

    // slot-hk MUST NOT select entry-shared (cannot borrow JP tag from src-jp)
    // slot-jp MUST select entry-shared (inherits JP from src-jp)
    const inSlotHk = selected.filter((n) => n.slotKey === slotHkKey)
    const inSlotJp = selected.filter((n) => n.slotKey === slotJpKey)

    expect(inSlotHk).toHaveLength(0)
    expect(inSlotJp).toHaveLength(1)
    expect(inSlotJp[0].entryId).toBe('entry-shared')
    expect(inSlotJp[0].sourceId).toBe('src-jp')
  })

  it('does not enqueue compile for incomplete profiles when repairing a needs_repair template', async () => {
    const sqlite = new DatabaseSync(':memory:')
    const env = createTestEnv(sqlite)
    const database = drizzle(env.DB)

    // Apply complete schema
    sqlite.exec(fs.readFileSync(path.resolve('drizzle/0000_initial.sql'), 'utf8'))
    sqlite.exec(fs.readFileSync(path.resolve('drizzle/0001_seed_manual_source.sql'), 'utf8'))
    for (const stmt of fs
      .readFileSync(path.resolve('drizzle/0002_windy_nightshade.sql'), 'utf8')
      .split('--> statement-breakpoint')) {
      if (stmt.trim()) sqlite.exec(stmt.trim())
    }

    const now = new Date()
    await database.insert(sources).values({
      id: 'src-1',
      name: '源1',
      kind: 'url',
      enabled: true,
      createdAt: now,
      updatedAt: now,
    })

    // Template in needs_repair
    await database.insert(templates).values({
      id: 'tpl-needs-repair',
      name: '待修复模板',
      yaml: 'invalid: template',
      migrationStatus: 'needs_repair',
      migrationError: '模板需要修复槽位',
      createdAt: now,
      updatedAt: now,
    })

    await database.insert(profiles).values({
      id: 'p-incomplete',
      name: '待补齐配置',
      templateId: 'tpl-needs-repair',
      compiledYaml: '# last good compiled yaml',
      createdAt: now,
      updatedAt: now,
    })

    // While in needs_repair: enqueueProfilesForTemplate does not queue jobs
    const initialJobs = await enqueueProfilesForTemplate(env, 'tpl-needs-repair')
    expect(initialJobs).toHaveLength(0)

    // Manual compile endpoint rejects
    const compileRes1 = await profilesRouter.request('/p-incomplete/compile', { method: 'POST' }, env)
    expect(compileRes1.status).toBe(409)

    // Admin repairs template to ready with a new slot
    const repairedSlotKey = '__WANGWANG_SOURCE_SLOT_fixed1__'
    const repairedYaml = `x-wangwang:
  sources:
    - key: ${repairedSlotKey}
      name: 修复后槽位
proxy-groups:
  - name: 节点选择
    type: select
    proxies:
      - ${repairedSlotKey}
rules:
  - MATCH,节点选择
`
    await database
      .update(templates)
      .set({
        yaml: repairedYaml,
        migrationStatus: 'ready',
        migrationError: null,
        updatedAt: new Date(),
      })
      .where(eq(templates.id, 'tpl-needs-repair'))

    // After repair, p-incomplete still has 0 bindings for repairedSlotKey -> complete is false
    const jobsAfterRepair = await enqueueProfilesForTemplate(env, 'tpl-needs-repair')
    expect(jobsAfterRepair).toHaveLength(0)

    // Ensure zero jobs were created in DB
    const allJobs = await database.select().from(jobs)
    expect(allJobs).toHaveLength(0)

    // Existing compiledYaml remains untouched and intact
    const prof = await database.select().from(profiles).where(eq(profiles.id, 'p-incomplete')).get()
    expect(prof?.compiledYaml).toBe('# last good compiled yaml')

    // Manual compile endpoint rejects incomplete bindings with 400
    const compileRes2 = await profilesRouter.request('/p-incomplete/compile', { method: 'POST' }, env)
    expect(compileRes2.status).toBe(400)
    const errBody = (await compileRes2.json()) as any
    expect(errBody.error.code).toBe('PROFILE_SOURCE_BINDINGS_INVALID')
  })

  it('rejects duplicating a needs_repair template with 409', async () => {
    const sqlite = new DatabaseSync(':memory:')
    const env = createTestEnv(sqlite)
    const database = drizzle(env.DB)

    // Apply complete schema
    sqlite.exec(fs.readFileSync(path.resolve('drizzle/0000_initial.sql'), 'utf8'))
    sqlite.exec(fs.readFileSync(path.resolve('drizzle/0001_seed_manual_source.sql'), 'utf8'))
    for (const stmt of fs
      .readFileSync(path.resolve('drizzle/0002_windy_nightshade.sql'), 'utf8')
      .split('--> statement-breakpoint')) {
      if (stmt.trim()) sqlite.exec(stmt.trim())
    }

    const now = new Date()
    await database.insert(templates).values({
      id: 'tpl-broken',
      name: '损坏模板',
      yaml: 'broken: yaml: [[',
      migrationStatus: 'needs_repair',
      migrationError: '语法错误',
      createdAt: now,
      updatedAt: now,
    })

    const res = await templatesRouter.request('/tpl-broken/duplicate', { method: 'POST' }, env)
    expect(res.status).toBe(409)
    const body = (await res.json()) as any
    expect(body.error.code).toBe('TEMPLATE_MIGRATION_REQUIRED')

    // Confirm no duplicate template was created
    const tpls = await database.select().from(templates)
    expect(tpls).toHaveLength(1)
  })

  it('rejects profile with >20 distinct sources before D1 query', async () => {
    const sqlite = new DatabaseSync(':memory:')
    const env = createTestEnv(sqlite)

    const slots = [{ key: '__WANGWANG_SOURCE_SLOT_slot01__', name: '槽位1' }]
    const distinct21 = Array.from({ length: 21 }, (_, i) => `src-${i + 1}`)

    // 1. Zod schema rejection
    const parsed = profileSchema.safeParse({
      name: '超出上限测试',
      sourceBindings: [{ slotKey: '__WANGWANG_SOURCE_SLOT_slot01__', sourceIds: distinct21 }],
    })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues[0].message).toMatch(/不同节点源总数不能超过 20 个/)
    }

    // 2. Pre-D1 query check in validateProfileSourceBindings
    await expect(
      validateProfileSourceBindings(env, slots, [
        { slotKey: '__WANGWANG_SOURCE_SLOT_slot01__', sourceIds: distinct21 },
      ]),
    ).rejects.toThrow('配置引用的不同节点源总数不能超过 20 个')
  })
})
