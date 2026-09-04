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
  table: 'node_tags' | 'source_tags' | 'profile_tag_filters',
  ownerColumn: 'node_id' | 'source_id' | 'profile_id',
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

export async function replaceNodeDirectTags(env: Env, nodeId: string, names: string[]) {
  const tags = await ensureTags(env, names)
  await replaceRelations(env, 'node_tags', 'node_id', nodeId, tags)
  return tags
}

export async function replaceNodeDirectTagsForNodes(env: Env, nodeIds: string[], names: string[]) {
  if (!nodeIds.length) return []
  const tags = await ensureTags(env, names)
  const statements: D1PreparedStatement[] = [
    env.DB.prepare('DELETE FROM node_tags WHERE node_id IN (SELECT value FROM json_each(?))').bind(
      JSON.stringify(nodeIds),
    ),
  ]
  if (tags.length)
    statements.push(
      env.DB.prepare(
        `INSERT INTO node_tags (node_id, tag_id)
         SELECT node_ids.value, tag_ids.value FROM json_each(?) node_ids CROSS JOIN json_each(?) tag_ids`,
      ).bind(JSON.stringify(nodeIds), JSON.stringify(tags.map((tag) => tag.id))),
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

export async function nodeTagViews(env: Env, nodeIds: string[]) {
  const result = new Map<string, { direct: TagView[]; inherited: TagView[] }>()
  for (const nodeId of nodeIds) result.set(nodeId, { direct: [], inherited: [] })
  for (let index = 0; index < nodeIds.length; index += 100) {
    const chunk = nodeIds.slice(index, index + 100)
    const vars = placeholders(chunk.length)
    const direct = await env.DB.prepare(
      `SELECT nt.node_id AS nodeId, t.id, t.name
       FROM node_tags nt JOIN tags t ON t.id = nt.tag_id
       WHERE nt.node_id IN (${vars})
       ORDER BY t.normalized_name`,
    )
      .bind(...chunk)
      .all<{ nodeId: string; id: string; name: string }>()
    for (const row of direct.results) result.get(row.nodeId)?.direct.push({ id: row.id, name: row.name })
  }

  const inherited = nodeIds.length
    ? await env.DB.prepare(
        `SELECT n.id AS nodeId, t.id, t.name
         FROM nodes n
         JOIN sources s ON s.id = n.source_id
         JOIN source_tags st ON st.source_id = n.source_id
         JOIN tags t ON t.id = st.tag_id
         JOIN json_each(?) selected ON n.id = selected.value
         WHERE s.enabled = 1
         ORDER BY t.normalized_name`,
      )
        .bind(JSON.stringify(nodeIds))
        .all<{ nodeId: string; id: string; name: string }>()
    : { results: [] }
  for (const row of inherited.results) result.get(row.nodeId)?.inherited.push({ id: row.id, name: row.name })
  return result
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
