import { eq, inArray, sql } from 'drizzle-orm'
import { nodes, profileSlotBindings, profileSlotNodes, profileSlotSources, sources } from './db'
import { db } from './tasks'
import type { TemplateSourceSlot } from './templates/source-slots'

export type ProfileSlotBindingInput =
  | {
      slotKey: string
      mode: 'source'
      sourceIds: string[]
      includeRegex: string | null
      excludeRegex: string | null
    }
  | { slotKey: string; mode: 'node'; nodeIds: string[] }

export type ProfileSlotBinding =
  | Extract<ProfileSlotBindingInput, { mode: 'source' }>
  | (Extract<ProfileSlotBindingInput, { mode: 'node' }> & { missingNodeIds: string[] })

function normalizeRegex(value: string | null, slotName: string, label: string) {
  const normalized = value?.trim() || null
  if (!normalized) return null
  if (normalized.length > 200) throw new Error(`槽位“${slotName}”的${label}正则不能超过 200 个字符`)
  try {
    new RegExp(normalized)
  } catch {
    throw new Error(`槽位“${slotName}”的${label}正则无效`)
  }
  return normalized
}

export async function validateProfileSlotBindings(
  env: Env,
  slots: TemplateSourceSlot[],
  bindings: ProfileSlotBindingInput[],
) {
  const slotKeys = new Set(slots.map(({ key }) => key))
  const bindingMap = new Map(bindings.map((binding) => [binding.slotKey, binding]))
  if (bindingMap.size !== bindings.length || bindings.some(({ slotKey }) => !slotKeys.has(slotKey)))
    throw new Error('动态节点槽绑定无效')

  const normalized: ProfileSlotBindingInput[] = slots.map(({ key, name }) => {
    const binding = bindingMap.get(key)
    if (!binding) throw new Error(`缺少槽位“${name}”的绑定`)
    if (binding.mode === 'source') {
      const sourceIds = [...new Set(binding.sourceIds)]
      if (!sourceIds.length) throw new Error(`槽位“${name}”至少需要一个节点源`)
      return {
        slotKey: key,
        mode: 'source',
        sourceIds,
        includeRegex: normalizeRegex(binding.includeRegex, name, '包含'),
        excludeRegex: normalizeRegex(binding.excludeRegex, name, '排除'),
      }
    }
    const nodeIds = [...new Set(binding.nodeIds)]
    if (!nodeIds.length) throw new Error(`槽位“${name}”至少需要一个指定节点`)
    return { slotKey: key, mode: 'node', nodeIds }
  })

  const sourceIds = [...new Set(normalized.flatMap((binding) => (binding.mode === 'source' ? binding.sourceIds : [])))]
  if (sourceIds.length > 20) throw new Error('配置引用的节点源不能超过 20 个')
  if (sourceIds.length) {
    const found = await db(env)
      .select({ id: sources.id, enabled: sources.enabled })
      .from(sources)
      .where(inArray(sources.id, sourceIds))
    if (found.length !== sourceIds.length) throw new Error('包含不存在的节点源')
    if (found.some(({ enabled }) => !enabled)) throw new Error('不能绑定已停用的节点源')
  }

  const nodeIds = [...new Set(normalized.flatMap((binding) => (binding.mode === 'node' ? binding.nodeIds : [])))]
  if (nodeIds.length > 1000) throw new Error('配置指定的节点不能超过 1000 个')
  if (nodeIds.length) {
    const found: Array<{ id: string; nodeEnabled: boolean; sourceEnabled: boolean }> = []
    for (let index = 0; index < nodeIds.length; index += 90)
      found.push(
        ...(await db(env)
          .select({ id: nodes.id, nodeEnabled: nodes.enabled, sourceEnabled: sources.enabled })
          .from(nodes)
          .innerJoin(sources, eq(sources.id, nodes.sourceId))
          .where(inArray(nodes.id, nodeIds.slice(index, index + 90)))),
      )
    if (found.length !== nodeIds.length) throw new Error('包含不存在的指定节点')
    if (found.some(({ nodeEnabled, sourceEnabled }) => !nodeEnabled || !sourceEnabled))
      throw new Error('不能绑定已停用的节点或其所属节点源')
  }
  return normalized
}

export async function readProfileSlotBindings(env: Env, profileId: string): Promise<ProfileSlotBinding[]> {
  const [bindings, sourceRows, nodeRows] = await Promise.all([
    db(env).select().from(profileSlotBindings).where(eq(profileSlotBindings.profileId, profileId)),
    db(env).select().from(profileSlotSources).where(eq(profileSlotSources.profileId, profileId)),
    db(env).select().from(profileSlotNodes).where(eq(profileSlotNodes.profileId, profileId)),
  ])
  const sourceIds = new Map<string, string[]>()
  const nodeIds = new Map<string, string[]>()
  for (const row of sourceRows) sourceIds.set(row.slotKey, [...(sourceIds.get(row.slotKey) || []), row.sourceId])
  for (const row of nodeRows) nodeIds.set(row.slotKey, [...(nodeIds.get(row.slotKey) || []), row.nodeId])
  const allNodeIds = [...new Set(nodeRows.map(({ nodeId }) => nodeId))]
  const existing = new Set<string>()
  for (let index = 0; index < allNodeIds.length; index += 90) {
    const rows = await db(env)
      .select({ id: nodes.id })
      .from(nodes)
      .where(inArray(nodes.id, allNodeIds.slice(index, index + 90)))
    for (const { id } of rows) existing.add(id)
  }
  return bindings.map((binding) =>
    binding.mode === 'source'
      ? {
          slotKey: binding.slotKey,
          mode: 'source' as const,
          sourceIds: sourceIds.get(binding.slotKey) || [],
          includeRegex: binding.includeRegex,
          excludeRegex: binding.excludeRegex,
        }
      : {
          slotKey: binding.slotKey,
          mode: 'node' as const,
          nodeIds: nodeIds.get(binding.slotKey) || [],
          missingNodeIds: (nodeIds.get(binding.slotKey) || []).filter((id) => !existing.has(id)),
        },
  )
}

export async function replaceProfileSlotBindings(env: Env, profileId: string, bindings: ProfileSlotBindingInput[]) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM profile_slot_bindings WHERE profile_id = ?').bind(profileId),
    ...bindings.map((binding) =>
      env.DB.prepare(
        'INSERT INTO profile_slot_bindings (profile_id, slot_key, mode, include_regex, exclude_regex) VALUES (?, ?, ?, ?, ?)',
      ).bind(
        profileId,
        binding.slotKey,
        binding.mode,
        binding.mode === 'source' ? binding.includeRegex : null,
        binding.mode === 'source' ? binding.excludeRegex : null,
      ),
    ),
    ...bindings.flatMap((binding) =>
      binding.mode === 'source'
        ? binding.sourceIds.map((sourceId) =>
            env.DB.prepare('INSERT INTO profile_slot_sources (profile_id, slot_key, source_id) VALUES (?, ?, ?)').bind(
              profileId,
              binding.slotKey,
              sourceId,
            ),
          )
        : binding.nodeIds.map((nodeId) =>
            env.DB.prepare('INSERT INTO profile_slot_nodes (profile_id, slot_key, node_id) VALUES (?, ?, ?)').bind(
              profileId,
              binding.slotKey,
              nodeId,
            ),
          ),
    ),
  ])
}

export async function sourceRequiredBySlot(env: Env, sourceId: string, enabledOnly: boolean) {
  const alternative = enabledOnly ? sql`AND s.enabled = 1` : sql``
  const row = await db(env).get(sql`
    SELECT 1
    FROM profile_slot_sources target
    WHERE target.source_id = ${sourceId}
      AND NOT EXISTS (
        SELECT 1
        FROM profile_slot_sources other
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
