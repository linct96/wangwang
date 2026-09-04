import { eq, inArray, sql } from 'drizzle-orm'
import { profileSourceBindings, sources } from './db'
import { db } from './tasks'
import type { TemplateSourceSlot } from './templates/source-slots'

export type ProfileSourceBindingInput = { slotKey: string; sourceIds: string[] }

export async function validateProfileSourceBindings(
  env: Env,
  slots: TemplateSourceSlot[],
  bindings: ProfileSourceBindingInput[],
) {
  const slotKeys = new Set(slots.map(({ key }) => key))
  const bindingMap = new Map(bindings.map(({ slotKey, sourceIds }) => [slotKey, [...new Set(sourceIds)]]))
  if (bindingMap.size !== bindings.length || bindings.some(({ slotKey }) => !slotKeys.has(slotKey)))
    throw new Error('节点源槽位绑定无效')

  const normalized = slots.map(({ key, name }) => {
    const sourceIds = bindingMap.get(key)
    if (!sourceIds?.length) throw new Error(`槽位“${name}”至少需要一个节点源`)
    return { slotKey: key, sourceIds }
  })
  const sourceIds = [...new Set(normalized.flatMap((binding) => binding.sourceIds))]
  if (sourceIds.length > 20) throw new Error('配置引用的节点源不能超过 20 个')
  const found = await db(env)
    .select({ id: sources.id, enabled: sources.enabled })
    .from(sources)
    .where(inArray(sources.id, sourceIds))
  if (found.length !== sourceIds.length) throw new Error('包含不存在的节点源')
  if (found.some(({ enabled }) => !enabled)) throw new Error('不能绑定已停用的节点源')
  return normalized
}

export async function readProfileSourceBindings(env: Env, profileId: string) {
  const rows = await db(env)
    .select({ slotKey: profileSourceBindings.slotKey, sourceId: profileSourceBindings.sourceId })
    .from(profileSourceBindings)
    .where(eq(profileSourceBindings.profileId, profileId))
  const grouped = new Map<string, string[]>()
  for (const { slotKey, sourceId } of rows) grouped.set(slotKey, [...(grouped.get(slotKey) || []), sourceId])
  return [...grouped].map(([slotKey, sourceIds]) => ({ slotKey, sourceIds }))
}

export async function replaceProfileSourceBindings(env: Env, profileId: string, bindings: ProfileSourceBindingInput[]) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM profile_source_bindings WHERE profile_id = ?').bind(profileId),
    ...bindings.flatMap(({ slotKey, sourceIds }) =>
      sourceIds.map((sourceId) =>
        env.DB.prepare('INSERT INTO profile_source_bindings (profile_id, slot_key, source_id) VALUES (?, ?, ?)').bind(
          profileId,
          slotKey,
          sourceId,
        ),
      ),
    ),
  ])
}

export async function sourceRequiredBySlot(env: Env, sourceId: string, enabledOnly: boolean) {
  const alternative = enabledOnly ? sql`AND s.enabled = 1` : sql``
  const row = await db(env).get(sql`
    SELECT 1
    FROM profile_source_bindings target
    WHERE target.source_id = ${sourceId}
      AND NOT EXISTS (
        SELECT 1
        FROM profile_source_bindings other
        JOIN sources s ON s.id = other.source_id
        WHERE other.profile_id = target.profile_id
          AND other.slot_key = target.slot_key
          AND other.source_id != ${sourceId}
          ${alternative}
      )
    LIMIT 1
  `)
  return Boolean(row)
}
