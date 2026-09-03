import { eq, sql } from 'drizzle-orm'
import { parseDocument, isSeq, isMap } from 'yaml'
import { db } from '../tasks'
import { profiles, profileSourceBindings, profileSources, templates } from '../db'
import { BUILTIN_TEMPLATE_SLOT_KEYS } from '../templates/builtin'
import { generateSourceSlotKey, parseTemplateSourceSlots, type TemplateSourceSlot } from '../templates/source-slots'
import { parseTemplateYaml } from '../templates/validator'

const LEGACY_PLACEHOLDER = '__WANGWANG_CUSTOM_SOURCE_NODES__'

export function migrateLegacyTemplateYaml(
  yamlContent: string,
  slotKey: string,
): { yaml: string; slot: TemplateSourceSlot } {
  const doc = parseDocument(yamlContent)

  if (doc.has('x-wangwang')) {
    throw new Error('模板已包含 x-wangwang 元数据，无法自动迁移')
  }

  if (!yamlContent.includes(LEGACY_PLACEHOLDER)) {
    throw new Error('模板未包含旧版节点源占位符 __WANGWANG_CUSTOM_SOURCE_NODES__，无法自动识别槽位')
  }

  // Add x-wangwang metadata with one slot
  doc.set(
    'x-wangwang',
    doc.createNode({
      sources: [
        {
          key: slotKey,
          name: '默认节点源',
        },
      ],
    }),
  )

  // Replace occurrences of __WANGWANG_CUSTOM_SOURCE_NODES__ in proxy-groups
  const proxyGroups = doc.get('proxy-groups')
  let replaced = 0
  if (isSeq(proxyGroups)) {
    for (const group of proxyGroups.items) {
      if (isMap(group)) {
        const proxies = group.get('proxies')
        if (isSeq(proxies)) {
          for (let i = 0; i < proxies.items.length; i++) {
            const item = proxies.items[i]
            const val = isMap(item) ? null : item
            if (val && String(val) === LEGACY_PLACEHOLDER) {
              proxies.set(i, slotKey)
              replaced++
            }
          }
        }
      }
    }
  }

  if (replaced === 0) {
    throw new Error('模板未在代理组 (proxy-groups) 中包含旧版节点源占位符，无法自动替换')
  }

  const transformedYaml = doc.toString()

  // Validate that the transformed template passes new template rules
  parseTemplateYaml(transformedYaml)

  return {
    yaml: transformedYaml,
    slot: {
      key: slotKey,
      name: '默认节点源',
    },
  }
}

export type ProfileBindingMigrationOperation = {
  profileId: string
  slotKey: string
  sourceId: string
}

export function planProfileBindingMigration({
  profiles,
  customTemplates,
  legacyProfileSources,
  existingBindings,
}: {
  profiles: Array<{ id: string; templateId: string }>
  customTemplates: Array<{ id: string; slotKey?: string }>
  legacyProfileSources: Array<{ profileId: string; sourceId: string }>
  existingBindings: Array<{ profileId: string; slotKey: string; sourceId: string }>
}): ProfileBindingMigrationOperation[] {
  const profileMap = new Map(profiles.map((p) => [p.id, p]))
  const customTemplateMap = new Map(customTemplates.map((t) => [t.id, t]))
  const existingSet = new Set(existingBindings.map((b) => `${b.profileId}:${b.slotKey}:${b.sourceId}`))

  const operations: ProfileBindingMigrationOperation[] = []

  for (const legacy of legacyProfileSources) {
    const profile = profileMap.get(legacy.profileId)
    if (!profile) continue

    let slotKey: string | undefined
    if (profile.templateId in BUILTIN_TEMPLATE_SLOT_KEYS) {
      slotKey = BUILTIN_TEMPLATE_SLOT_KEYS[profile.templateId as keyof typeof BUILTIN_TEMPLATE_SLOT_KEYS]
    } else {
      const customTpl = customTemplateMap.get(profile.templateId)
      if (customTpl?.slotKey) {
        slotKey = customTpl.slotKey
      }
    }

    if (!slotKey) continue

    const key = `${legacy.profileId}:${slotKey}:${legacy.sourceId}`
    if (!existingSet.has(key)) {
      existingSet.add(key)
      operations.push({
        profileId: legacy.profileId,
        slotKey,
        sourceId: legacy.sourceId,
      })
    }
  }

  return operations
}

export type TemplateMigrationPlan = {
  id: string
  action: 'migrate' | 'needs_repair' | 'noop'
  nextYaml?: string
  slotKey?: string
  error?: string
}

export function planTemplateMigration(
  templates: Array<{ id: string; yaml: string; migrationStatus?: string | null }>,
): TemplateMigrationPlan[] {
  return templates.map((tpl) => {
    if (tpl.yaml.includes(LEGACY_PLACEHOLDER)) {
      try {
        const slotKey = generateSourceSlotKey([])
        const { yaml: nextYaml, slot } = migrateLegacyTemplateYaml(tpl.yaml, slotKey)
        return {
          id: tpl.id,
          action: 'migrate',
          nextYaml,
          slotKey: slot.key,
        }
      } catch (err) {
        return {
          id: tpl.id,
          action: 'needs_repair',
          error: err instanceof Error ? err.message : '模板自动迁移失败',
        }
      }
    }

    try {
      const config = parseTemplateYaml(tpl.yaml)
      const slots = parseTemplateSourceSlots(config)
      return {
        id: tpl.id,
        action: 'noop',
        slotKey: slots[0]?.key,
      }
    } catch (err) {
      return {
        id: tpl.id,
        action: 'needs_repair',
        error: err instanceof Error ? err.message : '模板未配置节点源槽位',
      }
    }
  })
}

const MIGRATION_NAME = 'source_slots_v1'

export async function migrateLegacySourceSlots(env: Env): Promise<{
  migratedTemplates: number
  failedTemplates: number
  migratedProfiles: number
}> {
  const database = db(env)

  // Ensure persistent migrations table exists across isolates
  await database.run(
    sql`CREATE TABLE IF NOT EXISTS _app_migrations (name TEXT PRIMARY KEY, status TEXT NOT NULL, applied_at INTEGER NOT NULL)`,
  )

  // Atomic claim: only one isolate can insert with PRIMARY KEY constraint
  const claim = await database.run(
    sql`INSERT OR IGNORE INTO _app_migrations (name, status, applied_at) VALUES (${MIGRATION_NAME}, 'running', ${Date.now()})`,
  )

  // If another isolate claimed or already completed the migration
  if (claim.meta.changes === 0) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const record = await database.get<{ status: string; applied_at: number }>(
        sql`SELECT status, applied_at FROM _app_migrations WHERE name = ${MIGRATION_NAME}`,
      )
      if (record?.status === 'completed') {
        return {
          migratedTemplates: 0,
          failedTemplates: 0,
          migratedProfiles: 0,
        }
      }
      // Recover from stale lock if isolate crashed (> 60s)
      if (record?.status === 'running' && Date.now() - record.applied_at > 60_000) {
        const steal = await database.run(
          sql`UPDATE _app_migrations SET status = 'running', applied_at = ${Date.now()} WHERE name = ${MIGRATION_NAME} AND status = 'running'`,
        )
        if (steal.meta.changes > 0) break // Acquired stale lock
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return {
      migratedTemplates: 0,
      failedTemplates: 0,
      migratedProfiles: 0,
    }
  }

  let migratedTemplates = 0
  let failedTemplates = 0
  let migratedProfiles = 0

  try {
    // 1. Migrate custom templates that contain the legacy placeholder
    const customList = await database.select().from(templates)
    const templatePlans = planTemplateMigration(customList)
    const customSlotMap = new Map<string, string>()

    for (const plan of templatePlans) {
      if (plan.action === 'migrate' && plan.nextYaml && plan.slotKey) {
        await database
          .update(templates)
          .set({
            yaml: plan.nextYaml,
            migrationStatus: 'ready',
            migrationError: null,
            updatedAt: new Date(),
          })
          .where(eq(templates.id, plan.id))
        customSlotMap.set(plan.id, plan.slotKey)
        migratedTemplates++
      } else if (plan.action === 'needs_repair') {
        await database
          .update(templates)
          .set({
            migrationStatus: 'needs_repair',
            migrationError: plan.error || '模板需要修复槽位',
            updatedAt: new Date(),
          })
          .where(eq(templates.id, plan.id))
        failedTemplates++
      } else if (plan.action === 'noop' && plan.slotKey) {
        customSlotMap.set(plan.id, plan.slotKey)
      }
    }

    // 2. Query all profiles, legacy profile sources, and existing bindings
    const profileList = await database.select().from(profiles)
    const legacySources = await database.select().from(profileSources)
    const currentBindings = await database.select().from(profileSourceBindings)

    const operations = planProfileBindingMigration({
      profiles: profileList.map((p) => ({ id: p.id, templateId: p.templateId })),
      customTemplates: Array.from(customSlotMap.entries()).map(([id, slotKey]) => ({ id, slotKey })),
      legacyProfileSources: legacySources.map((ls) => ({
        profileId: ls.profileId,
        sourceId: ls.sourceId,
      })),
      existingBindings: currentBindings.map((b) => ({
        profileId: b.profileId,
        slotKey: b.slotKey,
        sourceId: b.sourceId,
      })),
    })

    // 3. Batch insert planned operations into profile_source_bindings (WITHOUT nonexistent created_at)
    for (const op of operations) {
      await database.run(
        sql`INSERT OR IGNORE INTO profile_source_bindings (profile_id, slot_key, source_id) VALUES (${op.profileId}, ${op.slotKey}, ${op.sourceId})`,
      )
      migratedProfiles++
    }

    // 4. Mark migration as permanently completed in persistent database
    await database.run(
      sql`UPDATE _app_migrations SET status = 'completed', applied_at = ${Date.now()} WHERE name = ${MIGRATION_NAME}`,
    )

    return {
      migratedTemplates,
      failedTemplates,
      migratedProfiles,
    }
  } catch (error) {
    await database.run(
      sql`UPDATE _app_migrations SET status = 'failed', applied_at = ${Date.now()} WHERE name = ${MIGRATION_NAME}`,
    )
    throw error
  }
}

let migrationDone = false

export async function ensureLegacySourceSlotsMigrated(env: Env) {
  if (migrationDone) return
  await migrateLegacySourceSlots(env)
  migrationDone = true
}
