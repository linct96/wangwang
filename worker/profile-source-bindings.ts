import { eq, inArray } from 'drizzle-orm'
import { profileSourceBindings, sources } from './db'
import { db } from './tasks'
import type { TemplateSourceSlot } from './templates/source-slots'

export type ProfileSourceBindingInput = {
  slotKey: string
  sourceIds: string[]
}

export type BindingSourceRecord = {
  id: string
  enabled: boolean
}

export function validateBindingsPure({
  slots,
  bindings,
  knownSources,
  existingSlotSourcePairs,
}: {
  slots: TemplateSourceSlot[]
  bindings: ProfileSourceBindingInput[]
  knownSources: Map<string, BindingSourceRecord>
  existingSlotSourcePairs?: Set<string>
}): ProfileSourceBindingInput[] {
  const slotMap = new Map(slots.map((slot) => [slot.key, slot]))
  const seenSlotKeys = new Set<string>()
  const bindingMap = new Map<string, string[]>()

  for (const binding of bindings) {
    if (seenSlotKeys.has(binding.slotKey)) {
      throw new Error(`槽位绑定重复：${binding.slotKey}`)
    }
    seenSlotKeys.add(binding.slotKey)

    if (!slotMap.has(binding.slotKey)) {
      throw new Error(`包含未知的节点源槽位：${binding.slotKey}`)
    }

    bindingMap.set(binding.slotKey, binding.sourceIds)
  }

  const normalizedBindings: ProfileSourceBindingInput[] = []
  const allDistinctSources = new Set<string>()

  for (const slot of slots) {
    const rawIds = bindingMap.get(slot.key)
    if (!rawIds) {
      throw new Error(`缺少槽位绑定：${slot.name}`)
    }

    const uniqueIds = [...new Set(rawIds)]
    if (uniqueIds.length === 0) {
      throw new Error(`槽位“${slot.name}”必须至少绑定一个节点源`)
    }

    let hasEnabled = false
    for (const sourceId of uniqueIds) {
      const record = knownSources.get(sourceId)
      if (!record) {
        throw new Error(`节点源不存在：${sourceId}`)
      }

      if (!record.enabled) {
        const pairKey = `${slot.key}:${sourceId}`
        if (!existingSlotSourcePairs?.has(pairKey)) {
          throw new Error(`不能绑定已禁用的节点源：${sourceId}`)
        }
      } else {
        hasEnabled = true
      }

      allDistinctSources.add(sourceId)
    }

    if (!hasEnabled) {
      throw new Error(`槽位“${slot.name}”必须至少包含一个启用的节点源`)
    }

    normalizedBindings.push({
      slotKey: slot.key,
      sourceIds: uniqueIds,
    })
  }

  if (allDistinctSources.size > 20) {
    throw new Error('配置引用的不同节点源总数不能超过 20 个')
  }

  return normalizedBindings
}

export async function validateProfileSourceBindings(
  env: Env,
  slots: TemplateSourceSlot[],
  bindings: ProfileSourceBindingInput[],
  existingBindings?: ProfileSourceBindingInput[],
): Promise<ProfileSourceBindingInput[]> {
  const allSourceIds = [...new Set(bindings.flatMap((b) => b.sourceIds))]
  const sourceRows = allSourceIds.length
    ? await db(env)
        .select({ id: sources.id, enabled: sources.enabled })
        .from(sources)
        .where(inArray(sources.id, allSourceIds))
    : []

  const knownSources = new Map(sourceRows.map((r) => [r.id, { id: r.id, enabled: r.enabled }]))

  const existingSlotSourcePairs = new Set<string>()
  if (existingBindings) {
    for (const eb of existingBindings) {
      for (const sid of eb.sourceIds) {
        existingSlotSourcePairs.add(`${eb.slotKey}:${sid}`)
      }
    }
  }

  return validateBindingsPure({
    slots,
    bindings,
    knownSources,
    existingSlotSourcePairs,
  })
}

export async function readProfileSourceBindings(env: Env, profileId: string): Promise<ProfileSourceBindingInput[]> {
  const rows = await db(env)
    .select({
      slotKey: profileSourceBindings.slotKey,
      sourceId: profileSourceBindings.sourceId,
    })
    .from(profileSourceBindings)
    .where(eq(profileSourceBindings.profileId, profileId))

  const map = new Map<string, string[]>()
  for (const row of rows) {
    if (!map.has(row.slotKey)) {
      map.set(row.slotKey, [])
    }
    map.get(row.slotKey)!.push(row.sourceId)
  }

  return Array.from(map.entries()).map(([slotKey, sourceIds]) => ({
    slotKey,
    sourceIds,
  }))
}

export async function replaceProfileSourceBindings(
  env: Env,
  profileId: string,
  bindings: ProfileSourceBindingInput[],
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    env.DB.prepare('DELETE FROM profile_source_bindings WHERE profile_id = ?').bind(profileId),
  ]

  for (const binding of bindings) {
    for (const sourceId of binding.sourceIds) {
      statements.push(
        env.DB.prepare('INSERT INTO profile_source_bindings (profile_id, slot_key, source_id) VALUES (?, ?, ?)').bind(
          profileId,
          binding.slotKey,
          sourceId,
        ),
      )
    }
  }

  await env.DB.batch(statements)
}

export async function profileBindingState(
  env: Env,
  profileId: string,
  slots: TemplateSourceSlot[],
): Promise<{ complete: boolean; bindings: ProfileSourceBindingInput[] }> {
  const storedBindings = await readProfileSourceBindings(env, profileId)
  const storedMap = new Map(storedBindings.map((b) => [b.slotKey, b.sourceIds]))

  // Group in template slot order
  const bindings: ProfileSourceBindingInput[] = slots.map((slot) => ({
    slotKey: slot.key,
    sourceIds: storedMap.get(slot.key) ?? [],
  }))

  const allBoundIds = [...new Set(bindings.flatMap((b) => b.sourceIds))]
  if (allBoundIds.length === 0) {
    return { complete: false, bindings }
  }

  const sourceRows = await db(env)
    .select({ id: sources.id, enabled: sources.enabled })
    .from(sources)
    .where(inArray(sources.id, allBoundIds))

  const enabledMap = new Map(sourceRows.map((r) => [r.id, r.enabled]))

  // Check that every slot has at least one enabled source
  let complete = true
  for (const slot of slots) {
    const ids = storedMap.get(slot.key)
    if (!ids || ids.length === 0) {
      complete = false
      break
    }
    const hasEnabled = ids.some((id) => enabledMap.get(id) === true)
    if (!hasEnabled) {
      complete = false
      break
    }
  }

  return { complete, bindings }
}
