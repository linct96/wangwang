import { normalizeTagInputs, normalizeTagName } from './tag-model'
import type { TagRecord, TagView } from './tag-model'

function placeholders(length: number) {
  return Array.from({ length }, () => '?').join(',')
}

export async function ensureTags(env: Env, names: string[]): Promise<TagRecord[]> {
  if (!names.length) return []
  const displayNames = normalizeTagInputs(names, names.length)
  const now = Date.now()
  await env.DB.batch(
    displayNames.map((name) =>
      env.DB.prepare(
        'INSERT OR IGNORE INTO tags (id, name, normalized_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(`tag_${crypto.randomUUID()}`, name, normalizeTagName(name), now, now),
    ),
  )
  const normalized = displayNames.map(normalizeTagName)
  const rows = await env.DB.prepare(
    `SELECT id, name, normalized_name AS normalizedName FROM tags WHERE normalized_name IN (${placeholders(normalized.length)})`,
  )
    .bind(...normalized)
    .all<TagRecord>()
  const byName = new Map(rows.results.map((row) => [row.normalizedName, row]))
  return normalized.map((name) => byName.get(name)).filter((tag): tag is TagRecord => Boolean(tag))
}

async function replaceRelations(
  env: Env,
  table: 'node_entry_tags' | 'source_tags' | 'profile_tag_filters',
  ownerColumn: 'entry_id' | 'source_id' | 'profile_id',
  ownerId: string,
  tags: TagRecord[],
) {
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`DELETE FROM ${table} WHERE ${ownerColumn} = ?`).bind(ownerId),
  ]
  for (const tag of tags)
    statements.push(env.DB.prepare(`INSERT INTO ${table} (${ownerColumn}, tag_id) VALUES (?, ?)`).bind(ownerId, tag.id))
  await env.DB.batch(statements)
}

export async function replaceEntryDirectTags(env: Env, entryId: string, names: string[]) {
  const tags = await ensureTags(env, names)
  await replaceRelations(env, 'node_entry_tags', 'entry_id', entryId, tags)
  return tags
}

export async function replaceEntryDirectTagsForEntries(env: Env, entryIds: string[], names: string[]) {
  if (!entryIds.length) return []
  const tags = await ensureTags(env, names)
  const statements: D1PreparedStatement[] = [
    env.DB.prepare('DELETE FROM node_entry_tags WHERE entry_id IN (SELECT value FROM json_each(?))').bind(
      JSON.stringify(entryIds),
    ),
  ]
  if (tags.length)
    statements.push(
      env.DB.prepare(
        `INSERT INTO node_entry_tags (entry_id, tag_id)
         SELECT entry_ids.value, tag_ids.value FROM json_each(?) entry_ids CROSS JOIN json_each(?) tag_ids`,
      ).bind(JSON.stringify(entryIds), JSON.stringify(tags.map((tag) => tag.id))),
    )
  await env.DB.batch(statements)
  return tags
}

export async function replaceSourceTags(env: Env, sourceId: string, names: string[]) {
  const tags = await ensureTags(env, names)
  await replaceRelations(env, 'source_tags', 'source_id', sourceId, tags)
  return tags
}

export async function replaceProfileTagFilters(env: Env, profileId: string, names: string[]) {
  const tags = await ensureTags(env, names)
  await replaceRelations(env, 'profile_tag_filters', 'profile_id', profileId, tags)
  return tags
}

export async function sourceTagViews(env: Env, sourceIds: string[]) {
  const result = new Map<string, TagView[]>()
  for (const sourceId of sourceIds) result.set(sourceId, [])
  if (!sourceIds.length) return result
  const rows = await env.DB.prepare(
    `SELECT st.source_id AS sourceId, t.id, t.name
     FROM source_tags st JOIN tags t ON t.id = st.tag_id
     WHERE st.source_id IN (${placeholders(sourceIds.length)})
     ORDER BY t.normalized_name`,
  )
    .bind(...sourceIds)
    .all<{ sourceId: string; id: string; name: string }>()
  for (const row of rows.results) result.get(row.sourceId)?.push({ id: row.id, name: row.name })
  return result
}

export async function entryTagViews(
  env: Env,
  entryIds: string[],
  sourcePairs?: Array<{ entryId: string; sourceId: string }>,
) {
  const directMap = new Map<string, TagView[]>()
  for (const entryId of entryIds) directMap.set(entryId, [])
  for (let index = 0; index < entryIds.length; index += 100) {
    const chunk = entryIds.slice(index, index + 100)
    const vars = placeholders(chunk.length)
    const direct = await env.DB.prepare(
      `SELECT net.entry_id AS entryId, t.id, t.name
       FROM node_entry_tags net JOIN tags t ON t.id = net.tag_id
       WHERE net.entry_id IN (${vars})
       ORDER BY t.normalized_name`,
    )
      .bind(...chunk)
      .all<{ entryId: string; id: string; name: string }>()
    for (const row of direct.results) directMap.get(row.entryId)?.push({ id: row.id, name: row.name })
  }

  const inheritedMap = new Map<string, TagView[]>()
  if (sourcePairs && sourcePairs.length > 0) {
    for (const sp of sourcePairs) {
      inheritedMap.set(`${sp.entryId}:${sp.sourceId}`, [])
    }
  }

  const inherited = sourcePairs
    ? await env.DB.prepare(
        `SELECT DISTINCT se.entry_id AS entryId, se.source_id AS sourceId, t.id, t.name
         FROM source_entries se
         JOIN sources s ON s.id = se.source_id
         JOIN source_tags st ON st.source_id = s.id
         JOIN tags t ON t.id = st.tag_id
         JOIN json_each(?) selected
           ON se.entry_id = json_extract(json(selected.value), '$.entryId')
          AND se.source_id = json_extract(json(selected.value), '$.sourceId')
         WHERE s.enabled = 1
         ORDER BY t.normalized_name`,
      )
        .bind(JSON.stringify(sourcePairs))
        .all<{ entryId: string; sourceId: string; id: string; name: string }>()
    : entryIds.length
      ? await env.DB.prepare(
          `SELECT DISTINCT se.entry_id AS entryId, se.source_id AS sourceId, t.id, t.name
           FROM source_entries se
           JOIN sources s ON s.id = se.source_id
           JOIN source_tags st ON st.source_id = se.source_id
           JOIN tags t ON t.id = st.tag_id
           JOIN json_each(?) selected ON se.entry_id = selected.value
           WHERE s.enabled = 1
           ORDER BY t.normalized_name`,
        )
          .bind(JSON.stringify(entryIds))
          .all<{ entryId: string; sourceId: string; id: string; name: string }>()
      : { results: [] }

  for (const row of inherited.results) {
    const key = `${row.entryId}:${row.sourceId}`
    if (!inheritedMap.has(key)) inheritedMap.set(key, [])
    const tags = inheritedMap.get(key)!
    if (!tags.some((tag) => tag.id === row.id)) tags.push({ id: row.id, name: row.name })
  }

  return {
    direct: directMap,
    inherited: inheritedMap,
    get(entryId: string, sourceId?: string): { direct: TagView[]; inherited: TagView[] } {
      const direct = directMap.get(entryId) || []
      if (sourceId) {
        const inherited = inheritedMap.get(`${entryId}:${sourceId}`) || []
        return { direct, inherited }
      }
      const inherited: TagView[] = []
      for (const [key, tags] of inheritedMap.entries()) {
        if (key.startsWith(`${entryId}:`)) {
          for (const t of tags) {
            if (!inherited.some((x) => x.id === t.id)) inherited.push(t)
          }
        }
      }
      return { direct, inherited }
    },
    has(entryId: string) {
      return directMap.has(entryId)
    },
  }
}

export async function profileTagViews(env: Env, profileId: string) {
  const rows = await env.DB.prepare(
    `SELECT t.id, t.name
     FROM profile_tag_filters ptf
     JOIN tags t ON t.id = ptf.tag_id
     WHERE ptf.profile_id = ?
     ORDER BY t.normalized_name`,
  )
    .bind(profileId)
    .all<TagView>()
  return rows.results
}

export async function profileFilterTagIds(env: Env, profileId: string) {
  const rows = await env.DB.prepare('SELECT tag_id AS tagId FROM profile_tag_filters WHERE profile_id = ?')
    .bind(profileId)
    .all<{ tagId: string }>()
  return rows.results.map((row) => row.tagId)
}

export async function listTags(env: Env) {
  const rows = await env.DB.prepare('SELECT id, name FROM tags ORDER BY normalized_name').all<TagView>()
  return rows.results
}
